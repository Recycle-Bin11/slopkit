/*
 * Web Browser shortcut installer for PlayStation 5.
 *
 * Based on the GPLv3 app-installation implementations from:
 *   - itsPLK/ps5-payload-manager
 *   - ps5-payload-dev/ftpsrv
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option)
 * any later version.
 */

#include <errno.h>
#include <stdarg.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <unistd.h>

#include <ps5/kernel.h>

#define TITLE_ID "SLOP00001"

#define INCASSET(name, file)                                                   \
  __asm__(".section .rodata\n"                                                 \
          ".global " #name "\n"                                                \
          ".global " #name "_end\n"                                            \
          ".global " #name "_size\n"                                           \
          ".align 16\n" #name ":\n"                                            \
          ".incbin \"" file "\"\n" #name "_end:\n" #name "_size:\n"            \
          ".quad " #name "_end - " #name "\n"                                  \
          ".previous\n");                                                      \
  extern const uint8_t name[];                                                 \
  extern const size_t name##_size;

INCASSET(param_json, "assets/param.json");
INCASSET(icon0_png, "assets/icon0.png");

int sceAppInstUtilInitialize(void);
int sceAppInstUtilTerminate(void);
int sceAppInstUtilAppInstallAll(void *);
int sceUserServiceInitialize(void *);

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

static int install_file(const char *path, const uint8_t *data, size_t size) {
  FILE *file = fopen(path, "wb");
  if (!file)
    return -1;

  int result = fwrite(data, 1, size, file) == size ? 0 : -1;
  fclose(file);
  return result;
}

static int install_app(void) {
  int (*install_title_dir)(const char *, const char *, void *) = 0;
  uint32_t handle;

  if (!kernel_dynlib_handle(-1, "libSceAppInstUtil.sprx", &handle)) {
    install_title_dir =
        (void *)kernel_dynlib_resolve(-1, handle, "Wudg3Xe3heE");
  }

  if (install_title_dir)
    return install_title_dir(TITLE_ID, "/user/app/", 0);
  return sceAppInstUtilAppInstallAll(0);
}

int main(void) {
  const char *base_dir = "/user/app/" TITLE_ID;
  const char *sce_sys_dir = "/user/app/" TITLE_ID "/sce_sys";
  const char *param_path =
      "/user/app/" TITLE_ID "/sce_sys/param.json";
  const char *icon_path = "/user/app/" TITLE_ID "/sce_sys/icon0.png";

  syscall(SYS_thr_set_name, -1, "web-installer.elf");
  notify("Web Browser: starting installation...");

  int user_priority = 256;
  int user_error = sceUserServiceInitialize(&user_priority);
  if (user_error)
    notify("Web Browser: UserService warning 0x%08X", user_error);

  notify("Web Browser: initializing AppInstUtil...");
  int error = sceAppInstUtilInitialize();
  if (error) {
    printf("sceAppInstUtilInitialize: error 0x%08X\n", error);
    notify("Web Browser: AppInstUtil error 0x%08X", error);
    return -1;
  }

  notify("Web Browser: writing shortcut files...");
  if ((mkdir(base_dir, 0755) && errno != EEXIST) ||
      (mkdir(sce_sys_dir, 0755) && errno != EEXIST)) {
    perror("mkdir");
    notify("Web Browser: failed to create app directories (errno %d)", errno);
    sceAppInstUtilTerminate();
    return -1;
  }

  if (install_file(param_path, param_json, param_json_size) ||
      install_file(icon_path, icon0_png, icon0_png_size)) {
    perror("install_file");
    notify("Web Browser: failed to write shortcut files (errno %d)", errno);
    sceAppInstUtilTerminate();
    return -1;
  }

  notify("Web Browser: registering home-screen shortcut...");
  error = install_app();
  if (error) {
    printf("install_app: error 0x%08X\n", error);
    notify("Web Browser: installation failed 0x%08X", error);
  } else {
    printf("Web Browser shortcut installed successfully.\n");
    notify("Web Browser shortcut installed successfully!");
  }

  sceAppInstUtilTerminate();
  return error ? -1 : 0;
}
