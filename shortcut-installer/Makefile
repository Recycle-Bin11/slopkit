SDK ?= /opt/ps5-payload-sdk
CC := $(SDK)/bin/prospero-clang
STRIP := $(SDK)/bin/prospero-strip

TARGET := $(SDK)/target
ELF := web-browser-installer.elf
SOURCE := installer.c
ASSETS := assets/param.json assets/icon0.png

CFLAGS := -Os -Wall -ffunction-sections -fdata-sections -I$(TARGET)/include
LDFLAGS := -Wl,--gc-sections -L$(TARGET)/lib \
	-lSceIpmi -lSceAppInstUtil -lSceUserService

.PHONY: all clean

all: $(ELF)

$(ELF): $(SOURCE) $(ASSETS)
	$(CC) $(CFLAGS) -o $@ $(SOURCE) $(LDFLAGS)
	$(STRIP) $@

clean:
	rm -f $(ELF)

