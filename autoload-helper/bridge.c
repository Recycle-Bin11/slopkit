/* SPDX-License-Identifier: MIT
 * Single-session, loopback-only file bridge for the Slopkit autoload editor.
 * No payload execution, FTP, outbound connections, credential patching or LAN listener.
 */
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <unistd.h>

#define MAGIC 0x31414c53U
#define LIMIT (4U * 1024U * 1024U)
#define PORT 9025
static int root_error;
static uint32_t get32(const unsigned char *p) {
    return (uint32_t)p[0] | (uint32_t)p[1]<<8 | (uint32_t)p[2]<<16 | (uint32_t)p[3]<<24;
}
static void put32(unsigned char *p, uint32_t n) {
    for (int i=0;i<4;i++) p[i]=(unsigned char)(n>>(8*i));
}
static int transfer(int fd, void *buf, size_t size, int writing) {
    unsigned char *p=buf;
    while (size) {
        ssize_t n=writing ? write(fd,p,size) : read(fd,p,size);
        if (n<0 && errno==EINTR) continue;
        if (n<=0) return -1;
        p+=n;size-=(size_t)n;
    }
    return 0;
}
static int reply(int fd, int error, const void *body, uint32_t size) {
    unsigned char header[16]={0};
    put32(header,MAGIC);put32(header+4,(uint32_t)error);put32(header+8,size);
    if (transfer(fd,header,16,1)) return -1;
    return size ? transfer(fd,(void *)body,size,1) : 0;
}
static int safe_name(const char *name) {
    size_t n=strlen(name);
    if (!n || n>250 || strstr(name,"..")) return 0;
    if (!((name[0]>='A' && name[0]<='Z') || (name[0]>='a' && name[0]<='z') || (name[0]>='0' && name[0]<='9'))) return 0;
    for (size_t i=0;i<n;i++) {
        unsigned char c=(unsigned char)name[i];
        if (!((c>='A' && c<='Z') || (c>='a' && c<='z') || (c>='0' && c<='9') ||
              c==' ' || c=='_' || c=='(' || c==')' || c=='.' || c=='+' || c=='-')) return 0;
    }
    return 1;
}
static int elf_name(const char *name) {
    size_t n=strlen(name);
    return n>4 && !strcasecmp(name+n-4,".elf");
}
static int staged(const char *name) {
    const char *p=strstr(name,".tmp-");
    char base[251];
    if (!p || !p[5]) return 0;
    size_t n=(size_t)(p-name);memcpy(base,name,n);base[n]=0;
    return !strcmp(base,"autoload.txt") || elf_name(base);
}
static int backup(const char *name) {
    return !strncmp(name,"autoload.txt.bak-",17) && name[17];
}
static int readable(const char *name) {
    return !strcmp(name,"autoload.txt") || elf_name(name) || staged(name) || backup(name);
}
static int handle(int fd, int directory, int *greeted) {
    unsigned char h[16];
    if (transfer(fd,h,16,0)) return -1;
    uint32_t magic=get32(h),op=get32(h+4),nl=get32(h+8),arg=get32(h+12);
    if (magic!=MAGIC || op>4 || nl>250 || arg>LIMIT) return -1;
    char name[251]={0};
    if (nl && transfer(fd,name,nl,0)) return -1;
    if (nl && (memchr(name,0,nl) || !safe_name(name))) return -1;
    if (op==0) {
        if (nl || arg || *greeted) return -1;
        *greeted=1;
        return reply(fd,0,"slopkit-autoload-v1",19);
    }
    if (!*greeted || !readable(name)) return -1;
    if (directory<0) {
        if (op!=1) return -1;
        return reply(fd,root_error,NULL,0);
    }
    unsigned char *body=NULL;
    uint32_t size=0;
    int err=0,file=-1;
    if (op==1) {
        if (!arg) err=EINVAL;
        else if ((file=openat(directory,name,O_RDONLY|O_NOFOLLOW))<0) err=errno;
        else {
            struct stat st;
            if (fstat(file,&st)) err=errno;
            else if (!S_ISREG(st.st_mode) || st.st_size<0 || (uint64_t)st.st_size>arg) err=EFBIG;
            else {
                size=(uint32_t)st.st_size;
                if (size && !(body=malloc(size))) err=ENOMEM;
                else if (size && transfer(file,body,size,0)) err=EIO;
            }
        }
    } else if (op==2) {
        // PUT is allowed only for brand-new staging files and TXT backups.
        if (!(staged(name)||backup(name))) return -1;
        if (arg && !(body=malloc(arg))) return -1;
        if (arg && transfer(fd,body,arg,0)) {free(body);return -1;}
        if ((file=openat(directory,name,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW,0644))<0) err=errno;
        else if ((arg && transfer(file,body,arg,1)) || fsync(file)) err=errno ? errno : EIO;
    } else if (op==3) {
        char dest[251]={0};
        if (!arg || arg>250 || transfer(fd,dest,arg,0)) return -1;
        if (memchr(dest,0,arg) || !safe_name(dest) || !staged(name) ||
            (strcmp(dest,"autoload.txt") && !elf_name(dest))) return -1;
        struct stat st;
        if (fstatat(directory,name,&st,AT_SYMLINK_NOFOLLOW)) err=errno;
        else if (!S_ISREG(st.st_mode)) err=EINVAL;
        else if (renameat(directory,name,directory,dest)) err=errno;
        else (void)fsync(directory);
    } else if (op==4) {
        if (arg || !(staged(name)||elf_name(name))) return -1;
        if (unlinkat(directory,name,0) && errno!=ENOENT) err=errno;
        else (void)fsync(directory);
    }
    if (file>=0 && close(file) && !err) err=errno;
    int result=reply(fd,err,op==1 && !err ? body : NULL,op==1 && !err ? size : 0);
    free(body);
    return result;
}
int main(int argc, char **argv) {
    const char *root="/data/ps5_autoloader";
    int port=PORT;
#ifdef AUTOLOAD_HOST_TEST
    if (argc!=3) return 2;
    root=argv[1];port=atoi(argv[2]);
#else
    (void)argc;(void)argv;
#endif
    signal(SIGPIPE,SIG_IGN);
    int directory=open(root,O_RDONLY|O_DIRECTORY|O_NOFOLLOW);
    root_error=directory<0 ? errno : 0;
    // Report the real directory-open errno through the handshake session.
    int listener=socket(AF_INET,SOCK_STREAM,0);
    if (listener<0) {if(directory>=0)close(directory);return 1;}
    int yes=1;setsockopt(listener,SOL_SOCKET,SO_REUSEADDR,&yes,sizeof(yes));
    struct sockaddr_in address;memset(&address,0,sizeof(address));
    address.sin_family=AF_INET;address.sin_port=htons((uint16_t)port);
    address.sin_addr.s_addr=htonl(INADDR_LOOPBACK);
#ifdef __FreeBSD__
    address.sin_len=sizeof(address);
#endif
    if (bind(listener,(struct sockaddr *)&address,sizeof(address)) || listen(listener,1)) {
        close(listener);if(directory>=0)close(directory);return 1;
    }
    struct pollfd ready={listener,POLLIN,0};
    if (poll(&ready,1,60000)<=0) {close(listener);if(directory>=0)close(directory);return 0;}
    int client=accept(listener,NULL,NULL);close(listener);
    if (client<0) {if(directory>=0)close(directory);return 1;}
    struct timeval receive={900,0},send={15,0};
    setsockopt(client,SOL_SOCKET,SO_RCVTIMEO,&receive,sizeof(receive));
    setsockopt(client,SOL_SOCKET,SO_SNDTIMEO,&send,sizeof(send));
    int greeted=0;
    for (int i=0;i<4096;i++) if (handle(client,directory,&greeted)) break;
    close(client);if(directory>=0)close(directory);
    return 0;
}
