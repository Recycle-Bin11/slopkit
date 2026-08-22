/*
 * Online-to-offline payload updater for PlayStation 5.
 *
 * Downloads an explicit, build-verified set of payloads from this repository
 * and atomically replaces their copies under /data/pldmgr/payloads and
 * /data/ps5_autoloader. It never deletes payloads that are not listed in
 * payloads-manifest.json.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

#include <curl/curl.h>
#include <errno.h>
#include <stdarg.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <strings.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <unistd.h>

#include "sha256.h"

#define BASE_DATA_DIR "/data/pldmgr"
#define PAYLOAD_DIR BASE_DATA_DIR "/payloads"
#define AUTOLOADER_DIR "/data/ps5_autoloader"

#define INCASSET(name, file)                                                   \
  __asm__(".section .rodata\n"                                                 \
          ".global " #name "\n"                                                \
          ".global " #name "_end\n"                                            \
          ".global " #name "_size\n"                                           \
          ".align 16\n" #name ":\n"                                            \
          ".incbin \"" file "\"\n" #name "_end:\n" #name "_size:\n"           \
          ".quad " #name "_end - " #name "\n"                                 \
          ".previous\n");                                                      \
  extern const uint8_t name[];                                                 \
  extern const size_t name##_size

INCASSET(cacert_pem, "assets/cacert.pem");

typedef struct {
  const char *source;
  const char *target;
  const char *url;
  unsigned long long size;
  const char *sha256;
} payload_update_t;

#include "generated/payload_manifest.h"

typedef struct notify_request {
  char unused[45];
  char message[3075];
} notify_request_t;

int sceKernelSendNotificationRequest(int device, notify_request_t *request,
                                     size_t size, int unused);

static void notify(const char *format, ...) {
  notify_request_t request;
  va_list args;
  memset(&request, 0, sizeof(request));
  va_start(args, format);
  vsnprintf(request.message, sizeof(request.message), format, args);
  va_end(args);
  sceKernelSendNotificationRequest(0, &request, sizeof(request), 0);
}

static int ensure_directory(const char *path) {
  if (mkdir(path, 0777) == 0 || errno == EEXIST) return 0;
  return -1;
}

static size_t write_download(void *data, size_t size, size_t count,
                             void *stream) {
  return fwrite(data, size, count, (FILE *)stream);
}

static int download_file(const char *url, const char *path) {
  FILE *file = fopen(path, "wb");
  CURL *curl;
  CURLcode result;
  long status = 0;
  int fd;
  if (!file) return -1;

  curl = curl_easy_init();
  if (!curl) {
    fclose(file);
    remove(path);
    return -1;
  }

  struct curl_blob ca = {(void *)cacert_pem, cacert_pem_size, CURL_BLOB_COPY};
  curl_easy_setopt(curl, CURLOPT_URL, url);
  curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_download);
  curl_easy_setopt(curl, CURLOPT_WRITEDATA, file);
  curl_easy_setopt(curl, CURLOPT_USERAGENT, "Recycle-Bin11-payload-updater/1.0");
  curl_easy_setopt(curl, CURLOPT_CAINFO_BLOB, &ca);
  curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 1L);
  curl_easy_setopt(curl, CURLOPT_SSL_VERIFYHOST, 2L);
  curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
  curl_easy_setopt(curl, CURLOPT_MAXREDIRS, 5L);
  curl_easy_setopt(curl, CURLOPT_FAILONERROR, 1L);
  curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 30L);
  curl_easy_setopt(curl, CURLOPT_TIMEOUT, 180L);
  curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);

  result = curl_easy_perform(curl);
  curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &status);
  curl_easy_cleanup(curl);

  if (fflush(file) != 0) result = CURLE_WRITE_ERROR;
  fd = fileno(file);
  if (fd >= 0 && fsync(fd) != 0) result = CURLE_WRITE_ERROR;
  if (fclose(file) != 0) result = CURLE_WRITE_ERROR;

  if (result != CURLE_OK || status != 200) {
    printf("download failed: curl=%d http=%ld url=%s\n", result, status, url);
    remove(path);
    return -1;
  }
  return 0;
}

static int file_matches(const char *path, const payload_update_t *update) {
  struct stat info;
  unsigned char magic[4];
  char digest[65];
  FILE *file;

  if (stat(path, &info) != 0 || !S_ISREG(info.st_mode) ||
      (unsigned long long)info.st_size != update->size)
    return 0;
  file = fopen(path, "rb");
  if (!file) return 0;
  if (fread(magic, 1, sizeof(magic), file) != sizeof(magic)) {
    fclose(file);
    return 0;
  }
  fclose(file);
  if (magic[0] != 0x7f || magic[1] != 'E' || magic[2] != 'L' ||
      magic[3] != 'F')
    return 0;
  if (compute_sha256_file(path, digest) != 0) return 0;
  return strcasecmp(digest, update->sha256) == 0;
}

static int copy_file_atomic(const char *source_path, const char *final_path,
                            const payload_update_t *update) {
  unsigned char buffer[16 * 1024];
  char temp_path[520];
  FILE *source;
  FILE *destination;
  size_t count;
  int failed = 0;
  int fd;

  if (snprintf(temp_path, sizeof(temp_path), "%s.part", final_path) >=
      (int)sizeof(temp_path))
    return -1;
  remove(temp_path);

  source = fopen(source_path, "rb");
  if (!source) return -1;
  destination = fopen(temp_path, "wb");
  if (!destination) {
    fclose(source);
    return -1;
  }

  while ((count = fread(buffer, 1, sizeof(buffer), source)) != 0) {
    if (fwrite(buffer, 1, count, destination) != count) {
      failed = 1;
      break;
    }
  }
  if (ferror(source)) failed = 1;
  if (fflush(destination) != 0) failed = 1;
  fd = fileno(destination);
  if (fd >= 0 && fsync(fd) != 0) failed = 1;
  if (fclose(destination) != 0) failed = 1;
  fclose(source);

  if (failed || !file_matches(temp_path, update)) {
    printf("copy verification failed: %s -> %s\n", source_path, final_path);
    remove(temp_path);
    return -1;
  }
  if (chmod(temp_path, 0755) != 0 || rename(temp_path, final_path) != 0) {
    printf("copy install failed: %s -> %s errno=%d\n", temp_path, final_path,
           errno);
    remove(temp_path);
    return -1;
  }
  return 0;
}

static int update_one(const payload_update_t *update) {
  char payload_path[512];
  char autoloader_path[512];
  char download_path[520];
  const char *source_path;
  int payload_current;
  int autoloader_current;
  int downloaded = 0;
  int failed = 0;

  if (snprintf(payload_path, sizeof(payload_path), "%s/%s", PAYLOAD_DIR,
               update->target) >= (int)sizeof(payload_path))
    return -1;
  if (snprintf(autoloader_path, sizeof(autoloader_path), "%s/%s",
               AUTOLOADER_DIR, update->target) >=
      (int)sizeof(autoloader_path))
    return -1;
  if (snprintf(download_path, sizeof(download_path), "%s/.%s.download.part",
               PAYLOAD_DIR, update->target) >= (int)sizeof(download_path))
    return -1;

  payload_current = file_matches(payload_path, update);
  autoloader_current = file_matches(autoloader_path, update);
  if (payload_current && autoloader_current) return 1;

  if (payload_current) {
    source_path = payload_path;
  } else if (autoloader_current) {
    source_path = autoloader_path;
  } else {
    remove(download_path);
    if (download_file(update->url, download_path) != 0) return -1;
    if (!file_matches(download_path, update)) {
      printf("verification failed: %s\n", update->source);
      remove(download_path);
      return -1;
    }
    source_path = download_path;
    downloaded = 1;
  }

  if (!payload_current &&
      copy_file_atomic(source_path, payload_path, update) != 0)
    failed = 1;
  if (!autoloader_current &&
      copy_file_atomic(source_path, autoloader_path, update) != 0)
    failed = 1;

  if (downloaded) remove(download_path);
  return failed ? -1 : 0;
}

int main(void) {
  size_t i;
  int updated = 0, current = 0, failed = 0;

  syscall(SYS_thr_set_name, -1, "payload-updater.elf");
  notify("Payload Update: checking %u payloads...",
         (unsigned int)PAYLOAD_UPDATE_COUNT);

  if (ensure_directory(BASE_DATA_DIR) != 0 ||
      ensure_directory(PAYLOAD_DIR) != 0 ||
      ensure_directory(AUTOLOADER_DIR) != 0) {
    notify("Payload Update failed: cannot open destination folders");
    return -1;
  }
  if (curl_global_init(CURL_GLOBAL_DEFAULT) != CURLE_OK) {
    notify("Payload Update failed: network initialization error");
    return -1;
  }

  for (i = 0; i < PAYLOAD_UPDATE_COUNT; ++i) {
    int result;
    notify("Payload Update: %u/%u %s", (unsigned int)(i + 1),
           (unsigned int)PAYLOAD_UPDATE_COUNT, PAYLOAD_UPDATES[i].target);
    result = update_one(&PAYLOAD_UPDATES[i]);
    if (result == 0)
      ++updated;
    else if (result == 1)
      ++current;
    else
      ++failed;
  }
  curl_global_cleanup();

  if (failed == 0) {
    notify("Payload Update complete: %d updated, %d current. Both offline folders are ready.",
           updated, current);
    return 0;
  }
  notify("Payload Update finished with errors: %d updated, %d current, %d failed.",
         updated, current, failed);
  return -1;
}
