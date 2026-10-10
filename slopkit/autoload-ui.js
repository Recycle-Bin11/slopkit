(function (root) {
"use strict";
root.mountAutoloadEditor = function (runtime) {
    const C = root.AutoloadEditorCore;
    const open = document.getElementById("editAutoload");
    const panel = document.getElementById("autoloadEditor");
    const list = document.getElementById("autoloadSteps");
    const choices = document.getElementById("autoloadChoices");
    const status = document.getElementById("autoloadStatus");
    const preview = document.getElementById("autoloadPreview");
    const readButton = document.getElementById("autoloadRead");
    const saveButton = document.getElementById("autoloadSave");
    const closeButton = document.getElementById("autoloadClose");
    let io = null, original = null, rows = [], busy = false, opened = false;
    function repaint() {
        void panel.offsetHeight;
        if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => {
            panel.style.visibility = "visible";
            void panel.offsetHeight;
        });
    }
    function message(text) { status.textContent = text; repaint(); }
    function controls() {
        panel.querySelectorAll("button, input").forEach(el => { el.disabled = busy; });
        saveButton.disabled = busy || original === null;
        document.getElementById("autoloadAddDelay").disabled = busy || original === null;
    }
    function button(text, action) {
        const el = document.createElement("button");
        el.type = "button"; el.textContent = text; el.addEventListener("click", action);
        return el;
    }
    function render() {
        list.textContent = ""; choices.textContent = "";
        rows.forEach((row, index) => {
            const item = document.createElement("li");
            const label = document.createElement("span");
            label.textContent = row.type === "payload" ? row.name
                : row.type === "delay" ? "Espera (ms): " : "Línea especial: " + row.value;
            item.appendChild(label);
            if (row.type === "delay") {
                const input = document.createElement("input");
                input.type = "number"; input.min = "0"; input.max = "3600000";
                input.step = "1"; input.value = row.ms;
                input.setAttribute("aria-label", "Delay del paso " + (index + 1) + " en milisegundos");
                input.addEventListener("change", () => {
                    if (!/^\d+$/.test(input.value) || Number(input.value) > 3600000) {
                        input.value = row.ms; message("Usá un delay entre 0 y 3600000 ms."); return;
                    }
                    row.ms = Number(input.value); render();
                });
                item.appendChild(input);
            }
            item.appendChild(button("↑", () => {
                if (index > 0) { [rows[index - 1], rows[index]] = [rows[index], rows[index - 1]]; render(); }
            }));
            item.appendChild(button("↓", () => {
                if (index + 1 < rows.length) { [rows[index + 1], rows[index]] = [rows[index], rows[index + 1]]; render(); }
            }));
            if (row.type !== "raw") item.appendChild(button("Quitar", () => { rows.splice(index, 1); render(); }));
            list.appendChild(item);
        });
        const entries = runtime.catalog().filter(p => C.validName(p.name)).slice();
        if (original !== null) C.names(C.parse(original)).forEach(name => {
            if (!entries.some(p => p.name === name)) entries.push({ name, title: name });
        });
        entries.forEach(payload => {
            const label = document.createElement("label");
            const checkbox = document.createElement("input"); checkbox.type = "checkbox";
            checkbox.checked = rows.some(r => r.type === "payload" && r.name === payload.name);
            checkbox.disabled = original === null;
            checkbox.addEventListener("change", () => {
                if (checkbox.checked) rows.push({ type: "payload", name: payload.name });
                else rows = rows.filter(r => r.type !== "payload" || r.name !== payload.name);
                render();
            });
            label.appendChild(checkbox);
            label.appendChild(document.createTextNode(" " + (payload.title || payload.name) + " — " + payload.name));
            choices.appendChild(label);
        });
        try { preview.textContent = C.serialize(rows) || "(secuencia vacía)"; }
        catch (error) { preview.textContent = error.message; }
        controls();
        if (original === null) choices.querySelectorAll("input").forEach(el => { el.disabled = true; });
    }
    async function task(action) {
        if (busy) return;
        busy = true; controls();
        try { runtime.ready(); if (!io) io = runtime.io(); await action(); }
        catch (error) { message(error.message); }
        finally { busy = false; render(); }
    }
    async function read() {
        await task(async () => {
            message("Leyendo autoload.txt desde la PS5…");
            const text = C.decode(await io.read("autoload.txt", C.MAX_TEXT));
            const parsed = C.parse(text); C.serialize(parsed);
            original = text; rows = parsed;
            message("Configuración cargada (" + (io.mode ? io.mode() : "acceso directo") + "). Los cambios se aplican al guardar.");
        });
    }
    open.addEventListener("click", async () => {
        if (opened) return;
        try { runtime.acquire(); opened = true; }
        catch (error) { runtime.toast(error.message); return; }
        panel.hidden = false; open.setAttribute("aria-expanded", "true");
        panel.scrollTop = 0;
        render(); repaint(); readButton.focus();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await read();
    });
    closeButton.addEventListener("click", async () => {
        if (busy) return;
        if (io && io.dispose) {
            busy = true; controls();
            try { await io.dispose(); } catch (error) { message(error.message); }
            finally { busy = false; }
        }
        io = null; if (runtime.resetIO) runtime.resetIO();
        panel.hidden = true; opened = false; runtime.release();
        original = null; rows = []; open.setAttribute("aria-expanded", "false"); if (new URLSearchParams(location.search).get("autoload") === "1") {
            location.replace("../index.html");
        } else open.focus();
    });
    const home = document.getElementById("autoloadHome");
    if (home) home.addEventListener("click", event => {
        event.preventDefault();
        if (!busy) closeButton.click();
    });
    readButton.addEventListener("click", read);
    document.getElementById("autoloadAddDelay").addEventListener("click", () => {
        rows.push({ type: "delay", ms: 500 }); render();
    });
    saveButton.addEventListener("click", () => task(async () => {
        const result = await C.save(io, original, rows, runtime.catalog(), runtime.download, message);
        original = result.text;
        message(result.warnings.length
            ? "Secuencia guardada. No se pudieron borrar: " + result.warnings.join("; ") + ". Respaldo: " + result.backup
            : "Guardado y verificado en PS5. Respaldo: " + result.backup);
    }));
    document.getElementById("autoloadExport").addEventListener("click", () => {
        const blob = new Blob([C.serialize(rows)], { type: "text/plain" });
        const link = document.createElement("a"); link.href = URL.createObjectURL(blob);
        link.download = "autoload.txt"; link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    });
};
})(window);
