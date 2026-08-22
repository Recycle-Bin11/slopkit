#ifndef PAYLOAD_UPDATER_SHA256_H
#define PAYLOAD_UPDATER_SHA256_H

#include <stddef.h>

typedef struct SHA256_CTX {
  unsigned char data[64];
  unsigned int datalen;
  unsigned long long bitlen;
  unsigned int state[8];
} SHA256_CTX;

void sha256_init(SHA256_CTX *ctx);
void sha256_update(SHA256_CTX *ctx, const unsigned char data[], size_t len);
void sha256_final(SHA256_CTX *ctx, unsigned char hash[]);
int compute_sha256_file(const char *path, char out_hex[65]);

#endif
