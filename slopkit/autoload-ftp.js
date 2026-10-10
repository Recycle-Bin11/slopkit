(function (root) {
"use strict";
root.createAutoloadFTP = function (tcp) {
    const encoder = new TextEncoder(), decoder = new TextDecoder();
    function path(name) {
        if (typeof name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9 _().+-]*$/.test(name)
            || name.includes("..") || name.length > 250) throw new Error("Nombre inválido.");
        return "/data/ps5_autoloader/" + name;
    }
    async function session(action) {
        let control = null, pending = "", data = null;
        const deadline = Date.now() + 120000;
        async function reply() {
            let firstCode = null, multiline = false, count = 0;
            for (let attempt = 0; attempt < 8192 && Date.now() < deadline; attempt++) {
                const end = pending.indexOf("\r\n");
                if (end < 0) {
                    const bytes = await tcp.read(control, 4096);
                    if (!bytes.length) throw new Error("FTP cerró la conexión.");
                    pending += decoder.decode(bytes);
                    if (pending.length > 65536) throw new Error("Respuesta FTP demasiado grande.");
                    continue;
                }
                const line = pending.slice(0, end); pending = pending.slice(end + 2);
                if (++count > 128) throw new Error("Demasiadas líneas FTP.");
                if (firstCode === null) {
                    const match = /^(\d{3})([ -])/.exec(line);
                    if (!match) throw new Error("Respuesta FTP inválida.");
                    firstCode = Number(match[1]); multiline = match[2] === "-";
                    if (!multiline) return { code: firstCode, line };
                } else if (line.startsWith(firstCode + " ")) return { code: firstCode, line };
            }
            throw new Error("Tiempo de espera FTP agotado.");
        }
        async function command(text, expected) {
            if (/[\r\n]/.test(text)) throw new Error("Comando FTP inválido.");
            await tcp.write(control, encoder.encode(text + "\r\n"));
            const result = await reply();
            if (expected && !expected.includes(result.code)) throw new Error(result.line);
            return result;
        }
        async function passive() {
            const result = await command("PASV", [227]);
            const match = /\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/.exec(result.line);
            if (!match || match.slice(1).some(n => Number(n) > 255)) throw new Error("PASV inválido.");
            const port = Number(match[5]) * 256 + Number(match[6]);
            if (port < 1024 || port > 65535) throw new Error("Puerto FTP inválido.");
            // Ignore the advertised host: always connect to console loopback.
            data = await tcp.connect(port);
        }
        try {
            control = await tcp.connect(2121);
            const welcome = await reply();
            if (welcome.code !== 220) throw new Error(welcome.line);
            const login = await command("USER anonymous", [230, 331]);
            if (login.code === 331) await command("PASS slopkit@local", [230]);
            await command("TYPE I", [200]);
            const api = {
                async read(name, max) {
                    const target = path(name);
                    const size = await command("SIZE " + target, [213]);
                    const bytesExpected = Number(size.line.slice(4).trim());
                    if (!Number.isSafeInteger(bytesExpected) || bytesExpected < 0 || bytesExpected > max)
                        throw new Error("Archivo FTP demasiado grande.");
                    await passive(); await command("RETR " + target, [125, 150]);
                    const chunks = []; let total = 0;
                    for (let i = 0; i < 8192 && Date.now() < deadline; i++) {
                        const bytes = await tcp.read(data, 65536);
                        if (!bytes.length) break;
                        total += bytes.length;
                        if (total > max) throw new Error("Archivo FTP excedió el límite.");
                        chunks.push(bytes);
                    }
                    await tcp.close(data); data = null;
                    const done = await reply();
                    if (![226, 250].includes(done.code) || total !== bytesExpected)
                        throw new Error("Lectura FTP incompleta: " + done.line);
                    const bytes = new Uint8Array(total); let off = 0;
                    for (const chunk of chunks) { bytes.set(chunk, off); off += chunk.length; }
                    return bytes;
                },
                async create(name, bytes) {
                    const target = path(name);
                    const check = await command("SIZE " + target);
                    // Only the server's explicit absence response permits a new staging file.
                    if (check.code !== 550 || !/no such file|not found/i.test(check.line))
                        throw new Error("No se puede crear el temporal: " + check.line);
                    await passive(); await command("STOR " + target, [125, 150]);
                    await tcp.write(data, bytes); await tcp.close(data); data = null;
                    const done = await reply();
                    if (![226, 250].includes(done.code)) throw new Error(done.line);
                },
                async rename(from, to) {
                    await command("RNFR " + path(from), [350]);
                    await command("RNTO " + path(to), [226, 250]);
                },
                async remove(name) { await command("DELE " + path(name), [226, 250]); }
            };
            return await action(api);
        } finally {
            if (data !== null) await tcp.close(data);
            if (control !== null) await tcp.close(control);
        }
    }
    return {
        read: (name, max) => session(io => io.read(name, max)),
        create: (name, bytes) => session(io => io.create(name, bytes)),
        rename: (from, to) => session(io => io.rename(from, to)),
        remove: name => session(io => io.remove(name))
    };
};
root.createAutoloadTCP = function (runtime) {
    const store = runtime.mem(65536), address = runtime.mem(16);
    const option = runtime.mem(16); option.u8.fill(0); option.u8[0] = 15;
    const one = runtime.mem(4); one.u8.fill(0); one.u8[0] = 1;
    const sockets = new Set();
    async function call(num, ...args) {
        const result = await runtime.sys(num, ...args);
        if (result.failed || result.s32 < 0) throw new Error("Conexión local: syscall " + num + ": " + result.errText);
        return result.s32;
    }
    async function close(fd) {
        if (!sockets.has(fd)) return;
        try { await call(6, fd); sockets.delete(fd); }
        catch (error) { if (runtime.block) runtime.block("Socket local sin cierre confirmado; reiniciá la PS5."); throw error; }
    }
    return {
        async connect(port) {
            const fd = await call(97, 2, 1, 0); sockets.add(fd);
            try {
                await call(105, fd, 65535, 0x0800, one.ptr, 4);
                await call(105, fd, 65535, 0x1005, option.ptr, 16);
                await call(105, fd, 65535, 0x1006, option.ptr, 16);
                address.u8.fill(0);
                address.u8.set([16, 2, port >>> 8, port & 255, 127, 0, 0, 1]);
                await call(98, fd, address.ptr, 16);
                return fd;
            } catch (error) { await close(fd); throw error; }
        },
        async read(fd, max) {
            const n = await call(3, fd, store.ptr, Math.min(max, 65536));
            if (n > Math.min(max, 65536)) throw new Error("Lectura local inválida.");
            return store.u8.slice(0, n);
        },
        async write(fd, bytes) {
            let off = 0, operations = 0; const deadline = Date.now() + 120000;
            while (off < bytes.length) {
                const size = Math.min(65536, bytes.length - off);
                store.u8.set(bytes.subarray(off, off + size));
                let sent = 0;
                while (sent < size) {
                    if (++operations > 8192 || Date.now() > deadline) throw new Error("Escritura local agotó el tiempo.");
                    const n = await call(4, fd, store.ptr.add32(sent), size - sent);
                    if (n <= 0 || n > size - sent) throw new Error("Escritura local incompleta.");
                    sent += n;
                }
                off += size;
            }
        },
        close
    };
};
})(window);
