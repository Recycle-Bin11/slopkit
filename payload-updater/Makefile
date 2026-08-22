SDK ?= /opt/ps5-payload-sdk
CC := $(SDK)/bin/prospero-clang
STRIP := $(SDK)/bin/prospero-strip
PYTHON ?= python3

TARGET := $(SDK)/target
ELF := payload-updater.elf
MANIFEST := payloads-manifest.json
MANIFEST_HEADER := generated/payload_manifest.h
CA_BUNDLE := assets/cacert.pem
SOURCES := updater.c sha256.c

CFLAGS := -Os -Wall -Wextra -ffunction-sections -fdata-sections \
	-I. -I$(TARGET)/include
LDFLAGS := -Wl,--gc-sections
LIBS := $(TARGET)/lib/libcurl.a \
	$(TARGET)/lib/libmbedtls.a \
	$(TARGET)/lib/libmbedx509.a \
	$(TARGET)/lib/libmbedcrypto.a \
	-L$(TARGET)/lib -lpthread \
	-lSceNetCtl -lSceUserService -lSceSystemService \
	-lSceHttp2 -lSceSsl -lSceNet

.PHONY: all clean validate-manifest

all: $(ELF)

validate-manifest: $(MANIFEST_HEADER)

$(MANIFEST_HEADER): $(MANIFEST) tools/generate_manifest_header.py \
	../payloads/ftpsrv-ps5.elf ../payloads/kstuff.elf \
	../payloads/shadowmountplus.elf
	mkdir -p generated
	$(PYTHON) tools/generate_manifest_header.py $(MANIFEST) $(MANIFEST_HEADER) ..

$(ELF): $(SOURCES) sha256.h $(MANIFEST_HEADER) $(CA_BUNDLE)
	$(CC) $(CFLAGS) -o $@ $(SOURCES) $(LDFLAGS) $(LIBS)
	$(STRIP) $@

clean:
	rm -f $(ELF) $(MANIFEST_HEADER)
