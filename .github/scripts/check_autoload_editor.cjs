"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const C = require("../../slopkit/autoload-core.js");
const initial = "!500\nftpsrv-ps5.elf\n!500\nshadowmountplus.elf\n!1000\nkstuff-1.13-fpkg-dr-test5.elf\n";
const elf = new Uint8Array(96); elf.set([127,69,76,70,2,1]); elf[18] = 62;
function fixture(text = initial, fail = () => false) {
    const files = new Map([["autoload.txt", C.encode(text)]]);
    C.names(C.parse(text)).forEach(n => files.set(n, elf.slice()));
    const log = [];
    return { files, log,
        read: async (n, max) => {
            log.push(["read", n]);
            if (fail("read", n) || !files.has(n)) throw new Error("read failed");
            const b = files.get(n); if (b.length > max) throw new Error("size");
            return b.slice();
        },
        create: async (n, b) => {
            log.push(["create", n]);
            if (fail("create", n) || files.has(n)) throw new Error("create failed");
            files.set(n, b.slice());
        },
        rename: async (from, to) => {
            log.push(["rename", from, to]);
            if (fail("rename", to)) throw new Error("rename failed");
            files.set(to, files.get(from)); files.delete(from);
        },
        remove: async n => {
            log.push(["remove", n]);
            if (fail("remove", n)) throw new Error("remove failed");
            files.delete(n);
        }
    };
}
async function save(io, rows, catalog = [{name:"new.elf"}], download = async () => elf.slice(), original = initial) {
    return C.save(io, original, rows, catalog, download, () => {});
}
(async function () {
    assert.equal(C.serialize(C.parse(initial.replace(/\n/g,"\r\n"))), initial);
    assert.deepEqual(C.parse("!500\nnew.elf\n"), [{type:"delay",ms:500},{type:"payload",name:"new.elf"}]);
    for (const name of ["../x.elf", "/data/x.elf", "x\n.elf", "x.elf/other", "x..elf"])
        assert.equal(C.validName(name), false);
    assert.equal(C.validName("FTP (test).ELF"), true);
    assert.throws(() => C.parse("!9999999999"), /rango/);
    assert.throws(() => C.serialize([{type:"delay",ms:-1}]));
    C.checkElf(elf);
    assert.throws(() => C.checkElf(new Uint8Array([127,69,76,70])));
    const rows = C.parse(initial).filter(r => r.name !== "shadowmountplus.elf");
    rows.push({type:"payload", name:"new.elf"}, {type:"delay",ms:2000});
    const io = fixture();
    const result = await save(io, rows);
    assert.equal(C.decode(io.files.get("autoload.txt")), C.serialize(rows));
    assert.equal(C.decode(io.files.get(result.backup)), initial);
    assert(io.files.has("new.elf")); assert(!io.files.has("shadowmountplus.elf"));
    const commit = io.log.findIndex(x => x[0] === "rename" && x[2] === "autoload.txt");
    const deletion = io.log.findIndex(x => x[0] === "remove" && x[1] === "shadowmountplus.elf");
    assert(deletion > commit);
    const changed = fixture(initial + "!1\n");
    await assert.rejects(() => save(changed, rows), /cambió/);
    assert(!changed.log.some(x => x[0] === "create"));
    const failed = fixture(initial, (op,n) => op === "rename" && n === "autoload.txt");
    await assert.rejects(() => save(failed, rows), /original no se reemplazó/);
    assert.equal(C.decode(failed.files.get("autoload.txt")), initial);
    assert(failed.files.has("shadowmountplus.elf"));
    const bad = fixture();
    await assert.rejects(() => save(bad, rows, [{name:"new.elf"}], async () => new Uint8Array(20)), /ELF/);
    assert.equal(C.decode(bad.files.get("autoload.txt")), initial);
    assert(bad.files.has("shadowmountplus.elf"));
    const warn = fixture(initial, (op,n) => op === "remove" && n === "shadowmountplus.elf");
    assert.equal((await save(warn, rows)).warnings.length, 1);
    const special = "@sync\n/data/ps5_autoloader/ftpsrv-ps5.elf\nftpsrv-ps5.elf\n";
    const preserved = fixture(special);
    const specialRows = C.parse(special).filter(r => r.type !== "payload");
    await save(preserved, specialRows, [], async () => elf, special);
    assert(preserved.files.has("ftpsrv-ps5.elf"));
    await assert.rejects(() => save(fixture(special), [], [], async () => elf, special), /especiales/);
    const absent = fixture();
    await assert.rejects(() => save(absent, [{type:"payload",name:"not-listed.elf"}]), /catálogo/);
    const conflict = fixture();
    await assert.rejects(() => save(conflict, rows, [{name:"new.elf"}], async () => {
        conflict.files.set("autoload.txt", C.encode(initial + "!10\n")); return elf;
    }), /cambió mientras/);
    assert(conflict.files.has("shadowmountplus.elf"));
    // Exercise the real syscall adapter with short reads/writes and fsync.
    const window = {};
    vm.runInNewContext(fs.readFileSync("slopkit/autoload-ps5.js","utf8"), { window, TextEncoder, Uint8Array, Date });
    const backingFiles = new Map([["autoload.txt", C.encode(initial)]]);
    const fds = new Map(); let next = 10; const calls = [];
    function mem(n) {
        const u8 = new Uint8Array(n);
        const ptr = { bytes:u8, offset:0, add32(off) { return {...this,offset:off}; } };
        return { u8, ptr };
    }
    const filename = p => C.decode(p.bytes.subarray(p.offset)).split("\0")[0].replace(C.DIR,"");
    const runtime = { mem, sys: async (num,...args) => {
        calls.push(num); let n = 0;
        if (num === 5) {
            const name = filename(args[0]), flags = args[1];
            if ((flags & 0x800) && backingFiles.has(name)) return {failed:true,s32:-17,errText:"exists"};
            if (!(flags & 0x200) && !backingFiles.has(name)) return {failed:true,s32:-2,errText:"missing"};
            if (flags & 0x200) backingFiles.set(name,new Uint8Array());
            n = next++; fds.set(n,{name,off:0});
            assert(flags & 0x100);
        } else if (num === 3) {
            const fd = fds.get(args[0]), data = backingFiles.get(fd.name);
            n = Math.min(args[2],7,data.length - fd.off);
            args[1].bytes.set(data.subarray(fd.off,fd.off+n),args[1].offset); fd.off += n;
        } else if (num === 4) {
            const fd = fds.get(args[0]), data = backingFiles.get(fd.name);
            n = Math.min(args[2],9);
            const bytes = new Uint8Array(data.length+n); bytes.set(data);
            bytes.set(args[1].bytes.subarray(args[1].offset,args[1].offset+n),data.length);
            backingFiles.set(fd.name,bytes);
        } else if (num === 6) { fds.delete(args[0]); }
        else if (num === 128) {
            const from = filename(args[0]), to = filename(args[1]); backingFiles.set(to,backingFiles.get(from)); backingFiles.delete(from);
        } else if (num === 10) { backingFiles.delete(filename(args[0])); }
        return {failed:false,s32:n,errText:"ok"};
    }};
    const adapter = window.createAutoloadPS5IO(runtime);
    assert.equal(C.decode(await adapter.read("autoload.txt",65536)), initial);
    await adapter.create("new.elf.tmp-123",elf);
    assert.deepEqual(await adapter.read("new.elf.tmp-123",4194304), elf);
    assert(calls.includes(95)); assert.equal(fds.size,0);
    await assert.rejects(() => adapter.read("../outside",10), /inválido/);
    await assert.rejects(() => adapter.read("missing.elf",10), /Acceso/);
    await assert.rejects(() => adapter.read("autoload.txt",3), /grande/);
    assert.equal(fds.size,0);
    const page = fs.readFileSync("slopkit/poops.html","utf8");
    assert(page.includes('id="editAutoload"') && page.includes('id="autoloadSave"'));
    assert(page.indexOf("autoload-core.js") < page.indexOf("window.mountAutoloadEditor("));

    // Evaluate the actual canonical route validator against the main-menu URLs.
    const index = fs.readFileSync("index.html","utf8");
    const autoloadLink = index.match(/id="run-autoload"[\s\S]*?href="([^"]+)"/)[1].replace(/&amp;/g,"&");
    const senderLink = index.match(/id="run-sender"[\s\S]*?href="([^"]+)"/)[1].replace(/&amp;/g,"&");
    const routeCode = page.slice(page.indexOf("const STAGE5_DRY_QUERY"), page.indexOf("function cleanNegativeCheckpoint"));
    const only = page.match(/const STAGE5_ONLY = ([\s\S]*?);/)[1];
    function validate(href) {
        const context={ Q:new URL(href,"https://example.test/").searchParams, window:{fw_str:"10.00"}, URLSearchParams };
        vm.runInNewContext("const ROUTE_VERSION='final'; const STAGE5_ONLY="+only+"; const STAGE5_FIRMWARES=['10.00'];\n"+routeCode+
            "\nresult={production:PRODUCTION_RUN,error:PRODUCTION_REQUEST_ERROR,stage:STAGE5_REQUEST_ERROR};",context);
        return context.result;
    }
    assert.equal(validate(autoloadLink).error,"");
    assert.equal(validate(autoloadLink).stage,"");
    assert(validate(autoloadLink).production);
    assert.equal(validate(senderLink).error,"");
    const freshLink = new URL(autoloadLink,"https://example.test/");
    freshLink.searchParams.delete("reuse");
    assert.equal(validate(freshLink.href).error,"");
    assert.equal(validate(freshLink.href).stage,"");
    assert(validate(freshLink.href).production);
    for (const suffix of ["&unexpected=1","&autoload=1"]) assert(validate(autoloadLink+suffix).error);
    assert(validate(autoloadLink.replace("v=final","v=autoload-3")).error);
    assert(validate(autoloadLink.replace("autoload=1","autoload=2")).error);
    // Exercise the actual reuse branch: hit, miss, and probe failure.
    const start=page.indexOf("    if (REUSE_ELFLDR) {",page.indexOf("(async function entry()"));
    const reuseCode=page.slice(start,page.indexOf("    if (PRODUCTION_RUN) {",start));
    async function reuseScenario(href,probe) {
        const events=[];
        const context={Q:new URL(href,"https://example.test/").searchParams,REUSE_ELFLDR:true,
            PRODUCTION_HREF:freshLink.href.replace("&autoload=1",""),
            screenLine:()=>{},stage:()=>{},flushMark:()=>{},sendRemoteEvents:()=>{},clean:x=>x,
            bootChain:async()=>events.push("boot"),refreshConsoleNetworkInfo:async()=>{},
            probeExistingElfLoader:async()=>{events.push("probe");if(probe==="error")throw new Error("probe error");return probe;},
            openExistingPayloadMenu:()=>events.push("open"),showLoaderPrompt:()=>events.push("prompt"),
            location:{replace:url=>events.push(url)}};
        await vm.runInNewContext("(async()=>{"+reuseCode+"})()",context);
        return events;
    }
    assert.deepEqual(await reuseScenario(autoloadLink,true),["boot","probe","open"]);
    const miss=await reuseScenario(autoloadLink,false);
    assert.deepEqual(miss.slice(0,2),["boot","probe"]);
    assert.equal(validate(miss[2]).error,"");
    assert.equal(new URL(miss[2]).searchParams.get("autoload"),"1");
    assert.equal(new URL(miss[2]).searchParams.has("reuse"),false);
    assert.deepEqual(await reuseScenario(senderLink,false),["boot","probe","prompt"]);
    assert.deepEqual(await reuseScenario(autoloadLink,"error"),["boot","probe"]);

    // Parse the existing inline module along with the inserted runtime bridge.
    const match = page.match(/<script type="module">([\s\S]*?)<\/script>/);
    assert(match);
    fs.writeFileSync("/tmp/slopkit-autoload-module.mjs", match[1]);
    console.log("Autoload tests passed: parsing, transactions, backups, conflict handling, ELF validation, deletions, path scope and syscall adapter.");
})().catch(error => { console.error(error); process.exitCode = 1; });
