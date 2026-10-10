SDK ?= /opt/ps5-payload-sdk
CC := $(SDK)/bin/prospero-clang
STRIP := $(SDK)/bin/prospero-strip
.PHONY: all clean
all: autoload-editor-helper.elf
autoload-editor-helper.elf: bridge.c
	$(CC) -Os -Wall -Wextra -Werror -o $@ $<
	$(STRIP) $@
clean:
	rm -f autoload-editor-helper.elf
