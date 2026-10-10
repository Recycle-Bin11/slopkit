"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const vm=require("node:vm"),net=require("node:net"),{spawn}=require("node:child_process");
const C=require("../../slopkit/autoload-core.js");
const window={};
vm.runInNewContext(fs.readFileSync("slopkit/autoload-bridge.js","utf8"),{window,Uint8Array,DataView,TextEncoder,TextDecoder,Number,Error,setTimeout,Promise});
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"slopkit-bridge-"));
const initial="!500\nftpsrv-ps5.elf\n!500\nshadowmountplus.elf\n!1000\nkstuff-1.13-fpkg-dr-test5.elf\n";
const elf=new Uint8Array(96);elf.set([127,69,76,70,2,1]);elf[18]=62;
fs.writeFileSync(path.join(dir,"autoload.txt"),initial);
C.names(C.parse(initial)).forEach(n=>fs.writeFileSync(path.join(dir,n),elf));
let child=null,launches=0;const live=new Set();
const port=19025;
// Native helper runs on a different test port; browser requests 9025 only.
async function launch() {
    if(child && child.exitCode===null) await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error("helper did not stop")),3000);
        child.once("exit",()=>{clearTimeout(timer);resolve();});
    });
    child=spawn(process.argv[2],[dir,String(port)],{stdio:["ignore","inherit","inherit"]});
    launches++;
}
const tcp={
    connect: async requested=>{
        assert.equal(requested,9025);
        return new Promise((resolve,reject)=>{
            const socket=net.createConnection({host:"127.0.0.1",port});
            const record={socket,queue:[],ended:false,error:null,wake:null};
            socket.on("data",bytes=>{record.queue.push(new Uint8Array(bytes));if(record.wake)record.wake();});
            socket.on("end",()=>{record.ended=true;if(record.wake)record.wake();});
            socket.on("error",error=>{record.error=error;if(record.wake)record.wake();reject(error);});
            socket.on("connect",()=>{live.add(record);resolve(record);});
        });
    },
    read: async (r,max)=>{
        while(!r.queue.length && !r.ended && !r.error)await new Promise((resolve,reject)=>{
            const timer=setTimeout(()=>reject(new Error("read timeout")),5000);
            r.wake=()=>{clearTimeout(timer);r.wake=null;resolve();};
        });
        if(r.error)throw r.error;
        if(!r.queue.length)return new Uint8Array();
        const chunk=r.queue[0],n=Math.min(chunk.length,max,11),result=chunk.slice(0,n);
        r.queue[0]=chunk.slice(n);if(!r.queue[0].length)r.queue.shift();
        return result;
    },
    write: async (r,bytes)=>new Promise((resolve,reject)=>r.socket.write(bytes,error=>error?reject(error):resolve())),
    close: async r=>{live.delete(r);r.socket.destroy();}
};
(async()=>{
    const io=window.createAutoloadBridge(tcp,launch);
    assert.equal(C.decode(await io.read("autoload.txt",65536)),initial);
    assert.equal(io.mode(),"auxiliar ELF (sin FTP)");
    const rows=C.parse(initial).filter(r=>r.name!=="shadowmountplus.elf");
    rows.push({type:"payload",name:"new.elf"},{type:"delay",ms:2000});
    const result=await C.save(io,initial,rows,[{name:"new.elf"}],async()=>elf.slice(),()=>{});
    assert.equal(fs.readFileSync(path.join(dir,"autoload.txt"),"utf8"),C.serialize(rows));
    assert.equal(fs.readFileSync(path.join(dir,result.backup),"utf8"),initial);
    assert(!fs.existsSync(path.join(dir,"shadowmountplus.elf")));
    assert.deepEqual(new Uint8Array(fs.readFileSync(path.join(dir,"new.elf"))),elf);
    await assert.rejects(()=>io.read("../outside",20),/inválido/);
    assert.equal(launches,1);
    await io.dispose();assert.equal(live.size,0);
    assert.equal(C.decode(await io.read("autoload.txt",65536)),C.serialize(rows));
    assert.equal(launches,2);
    // O_EXCL refuses replacing a staging file; error closes the session.
    await io.create("collision.elf.tmp-1",elf);
    await assert.rejects(()=>io.create("collision.elf.tmp-1",elf),/errno 17/);
    assert.deepEqual(new Uint8Array(fs.readFileSync(path.join(dir,"collision.elf.tmp-1"))),elf);
    const outside=path.join(dir,"outside.txt");fs.writeFileSync(outside,"secret");
    fs.symlinkSync(outside,path.join(dir,"linked.elf"));
    await assert.rejects(()=>io.read("linked.elf",100),/errno/);
    assert.equal(fs.readFileSync(outside,"utf8"),"secret");
    assert.equal(C.decode(await io.read("autoload.txt",65536)),C.serialize(rows));
    // Helper itself refuses deleting backups and accepts no arbitrary paths.
    await assert.rejects(()=>io.remove(result.backup),/cerró/);
    assert(fs.existsSync(path.join(dir,result.backup)));
    await io.dispose();
    const index=fs.readFileSync("index.html","utf8"),page=fs.readFileSync("slopkit/poops.html","utf8");
    assert(index.indexOf('id="run-sender"')<index.indexOf('id="run-autoload"'));
    assert(index.includes("&amp;autoload=1") && index.includes('document.getElementById("run-autoload")'));
    assert(page.includes('internalHelper === true && name === "autoload-editor-helper.elf"'));
    assert(page.includes("window.createAutoloadBridge("));
    assert(!page.includes("selected = ftp"));
    const metadata=JSON.parse(fs.readFileSync("_data/payloads.json","utf8"));
    assert(metadata["autoload-editor-helper.elf"].hidden);
    const binary=fs.readFileSync("payloads/autoload-editor-helper.elf");
    C.checkElf(new Uint8Array(binary));
    console.log("Native bridge + JS client tests passed: real file reads, verified saves, backups, deletions, exclusive staging, symlink rejection, session restart and main-menu navigation.");
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
    for(const r of live)r.socket.destroy();
    if(child && child.exitCode===null)child.kill();
});
