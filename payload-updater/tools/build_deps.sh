#!/usr/bin/env bash
# Build the same pinned TLS/download dependencies used by PS5 Payload Manager.
set -euo pipefail

SDK=/opt/ps5-payload-sdk
TARGET="$SDK/target"
export PATH="$SDK/bin:$PATH"
export CC=prospero-clang
export CXX=prospero-clang++
export AR=prospero-ar
export NM=prospero-nm
export RANLIB=prospero-ranlib

UPDATER_DEPS_DIR=$(mktemp -d)
trap 'rm -rf -- "$UPDATER_DEPS_DIR"' EXIT
cd "$UPDATER_DEPS_DIR"

echo "Building mbedTLS 3.6.0"
wget -q -O mbedtls.tar.gz \
  https://github.com/Mbed-TLS/mbedtls/archive/refs/tags/v3.6.0.tar.gz
tar xf mbedtls.tar.gz
cd mbedtls-*
make CC="$CC" AR="$AR" RANLIB="$RANLIB" CFLAGS="-Os" lib -j"$(nproc)"
mkdir -p "$TARGET/include" "$TARGET/lib"
cp -r include/mbedtls include/psa "$TARGET/include/"
cp library/libmbedtls.a library/libmbedx509.a library/libmbedcrypto.a \
  "$TARGET/lib/"

cd "$UPDATER_DEPS_DIR"
echo "Building libcurl 8.18.0"
wget -q -O curl.tar.xz https://curl.se/download/curl-8.18.0.tar.xz
tar xf curl.tar.xz
cd curl-8.18.0
./configure --prefix="$TARGET" \
  --host=x86_64-pc-freebsd \
  --enable-static --disable-shared \
  --with-mbedtls="$TARGET" \
  --without-openssl --without-libpsl \
  --disable-docs --disable-ftp --disable-ldap --disable-ldaps \
  --disable-rtsp --disable-proxy --disable-dict --disable-telnet \
  --disable-tftp --disable-pop3 --disable-imap --disable-smb \
  --disable-smtp --disable-gopher --disable-mqtt
make -j"$(nproc)"
make install
