(function (root) {
"use strict";
const DIR = "/data/ps5_autoloader/";
const MAX_TEXT = 65536;
function validName(name) {
    return typeof name === "string" && name.length <= 180
        && /^[A-Za-z0-9][A-Za-z0-9 _().+-]*\.elf$/i.test(name)
        && !name.includes("..");
}
function parse(text) {
    if (typeof text !== "string" || text.length > MAX_TEXT || text.includes("\0"))
        throw new Error("autoload.txt inválido o demasiado grande.");
    return text.replace(/\r\n/g, "\n").split("\n").filter(x => x !== "").map(line => {
        if (/^!\d+$/.test(line)) {
            const ms = Number(line.slice(1));
            if (!Number.isSafeInteger(ms) || ms < 0 || ms > 3600000)
                throw new Error("Delay fuera de rango (0 a 3600000 ms): " + line);
            return { type: "delay", ms };
        }
        return validName(line) ? { type: "payload", name: line }
            : { type: "raw", value: line };
    });
}
function serialize(rows) {
    if (!Array.isArray(rows) || rows.length > 256) throw new Error("Máximo 256 pasos.");
    const lines = rows.map(row => {
        if (row.type === "payload" && validName(row.name)) return row.name;
        if (row.type === "delay" && Number.isInteger(row.ms) && row.ms >= 0 && row.ms <= 3600000)
            return "!" + row.ms;
        if (row.type === "raw" && typeof row.value === "string"
            && row.value && !/[\r\n\0]/.test(row.value)) return row.value;
        throw new Error("Paso inválido.");
    });
    const text = lines.length ? lines.join("\n") + "\n" : "";
    if (text.length > MAX_TEXT) throw new Error("Secuencia demasiado grande.");
    return text;
}
function names(rows) { return [...new Set(rows.filter(r => r.type === "payload").map(r => r.name))]; }
function equal(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}
function encode(text) { return new TextEncoder().encode(text); }
function decode(bytes) { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
function checkElf(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 64 || bytes.length > 4194304
        || bytes[0] !== 127 || bytes[1] !== 69 || bytes[2] !== 76 || bytes[3] !== 70
        || bytes[4] !== 2 || bytes[5] !== 1 || bytes[18] !== 62 || bytes[19] !== 0)
        throw new Error("El archivo no es un ELF64 x86-64 válido (máximo 4 MiB).");
}
async function save(io, original, rows, catalog, download, progress) {
    const text = serialize(rows);
    const oldRows = parse(original);
    // Existing unrecognized directives/paths must not be silently altered.
    const raw = oldRows.filter(r => r.type === "raw").map(r => r.value);
    const keptRaw = rows.filter(r => r.type === "raw").map(r => r.value);
    if (JSON.stringify(raw) !== JSON.stringify(keptRaw))
        throw new Error("Las líneas especiales existentes deben conservarse.");
    const oldNames = names(oldRows), newNames = names(rows);
    const added = newNames.filter(n => !oldNames.includes(n));
    const removed = oldNames.filter(n => !newNames.includes(n));
    if (added.some(n => !catalog.some(p => p.name === n)))
        throw new Error("Solo se pueden agregar payloads del catálogo.");
    // Do not delete a safe filename still referenced by an existing absolute path.
    const deletable = removed.filter(n => !rows.some(r => r.type === "raw" && r.value === DIR + n));
    if (decode(await io.read("autoload.txt", MAX_TEXT)) !== original)
        throw new Error("El TXT cambió en la PS5. Volvé a leerlo antes de guardar.");
    const stamp = Date.now() + "-" + Math.floor(Math.random() * 1000000000);
    const backup = "autoload.txt.bak-" + stamp;
    const temps = [];
    let committed = false;
    try {
        progress("Creando respaldo…");
        await io.create(backup, encode(original));
        if (!equal(await io.read(backup, MAX_TEXT), encode(original)))
            throw new Error("No se pudo verificar el respaldo.");
        for (const name of added) {
            progress("Copiando " + name + "…");
            const bytes = await download(name);
            checkElf(bytes);
            const temp = name + ".tmp-" + stamp;
            temps.push(temp);
            await io.create(temp, bytes);
            if (!equal(await io.read(temp, 4194304), bytes))
                throw new Error("Verificación del ELF falló: " + name);
            await io.rename(temp, name);
        }
        const temp = "autoload.txt.tmp-" + stamp;
        temps.push(temp);
        await io.create(temp, encode(text));
        if (!equal(await io.read(temp, MAX_TEXT), encode(text)))
            throw new Error("Verificación del TXT temporal falló.");
        // Check again after downloads before replacing the live configuration.
        if (decode(await io.read("autoload.txt", MAX_TEXT)) !== original)
            throw new Error("El TXT cambió mientras guardabas. Volvé a leerlo.");
        progress("Guardando secuencia…");
        await io.rename(temp, "autoload.txt");
        committed = true;
        if (decode(await io.read("autoload.txt", MAX_TEXT)) !== text)
            throw new Error("No se pudo verificar el TXT guardado. Respaldo: " + backup);
        const warnings = [];
        for (const name of deletable) {
            progress("Quitando " + name + "…");
            try { await io.remove(name); }
            catch (error) { warnings.push(name + ": " + error.message); }
        }
        return { text, backup, warnings };
    } catch (error) {
        error.message += committed ? " La secuencia ya fue guardada; volvé a leerla."
            : " La secuencia original no se reemplazó.";
        throw error;
    } finally {
        for (const name of temps) { try { await io.remove(name); } catch (_) {} }
    }
}
const api = { DIR, MAX_TEXT, validName, parse, serialize, names, encode, decode, checkElf, save };
if (typeof module !== "undefined" && module.exports) module.exports = api;
else root.AutoloadEditorCore = api;
})(typeof window === "undefined" ? globalThis : window);
