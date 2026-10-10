(function (root) {
"use strict";
// FreeBSD/PS5 syscall numbers from slopkit/syscalls.js.
// All paths are scoped to the single autoloader directory.
root.createAutoloadPS5IO = function (runtime) {
    const dir = "/data/ps5_autoloader/";
    const buffer = runtime.mem(65536);
    const pathA = runtime.mem(512), pathB = runtime.mem(512);
    function path(name, store) {
        if (typeof name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9 _().+-]*$/.test(name)
            || name.includes("..") || name.length > 250)
            throw new Error("Nombre de archivo inválido.");
        const bytes = new TextEncoder().encode(dir + name);
        store.u8.fill(0); store.u8.set(bytes);
        return store.ptr;
    }
    async function call(number, ...args) {
        const result = await runtime.sys(number, ...args);
        if (result.failed || result.s32 < 0)
            throw new Error("Acceso a PS5 falló (" + number + "): " + result.errText
                + ". Comprobá permisos de /data después del jailbreak.");
        return result.s32;
    }
    async function read(name, max) {
        const fd = await call(5, path(name, pathA), 0x100, 0); // O_RDONLY | O_NOFOLLOW
        const chunks = [];
        let size = 0;
        try {
            const deadline = Date.now() + 120000;
            for (let i = 0; i < 8192 && Date.now() < deadline; i++) {
                const n = await call(3, fd, buffer.ptr, Math.min(65536, max + 1 - size));
                if (n === 0) {
                    const bytes = new Uint8Array(size);
                    let off = 0;
                    for (const chunk of chunks) { bytes.set(chunk, off); off += chunk.length; }
                    return bytes;
                }
                if (n > 65536 || size + n > max) throw new Error("Archivo demasiado grande.");
                chunks.push(buffer.u8.slice(0, n)); size += n;
            }
            throw new Error("Lectura excedió el límite de operaciones.");
        } finally { await call(6, fd); }
    }
    async function create(name, bytes) {
        // O_EXCL avoids following/replacing existing files for backups and staging.
        const fd = await call(5, path(name, pathA), 1 | 0x100 | 0x200 | 0x800, 0x1a4);
        let off = 0;
        try {
            while (off < bytes.length) {
                const end = Math.min(bytes.length, off + 65536);
                buffer.u8.set(bytes.subarray(off, end));
                let sent = 0;
                while (sent < end - off) {
                    const n = await call(4, fd, buffer.ptr.add32(sent), end - off - sent);
                    if (n <= 0 || n > end - off - sent) throw new Error("Escritura incompleta.");
                    sent += n;
                }
                off = end;
            }
            await call(95, fd); // fsync before close and rename
        } finally { await call(6, fd); }
    }
    return { read, create,
        rename: (from, to) => call(128, path(from, pathA), path(to, pathB)),
        remove: name => call(10, path(name, pathA)) };
};
})(window);
