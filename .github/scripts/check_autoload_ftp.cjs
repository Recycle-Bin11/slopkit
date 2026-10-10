"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const window = {};
vm.runInNewContext(fs.readFileSync("slopkit/autoload-ftp.js","utf8"), {window,TextEncoder,TextDecoder,Uint8Array,Date,Set});
function mock(options={}) {
    const files = new Map([["/data/ps5_autoloader/autoload.txt",new TextEncoder().encode("!500\nftpsrv-ps5.elf\n")]]);
    const sockets = new Map(), commands = []; let next = 1;
    let current = null;
    function queue(socket,text) { socket.queue.push(new TextEncoder().encode(text)); }
    const api = {
        files, commands, sockets,
        async connect(port) {
            assert(port===2121 || port===23456, "only expected loopback ports");
            const fd=next++, socket={queue:[],port,offset:0,bytes:null,store:null,output:[]};
            sockets.set(fd,socket);
            if(port===2121) {
                current=socket;
                queue(socket, "220-Welcome\r\nFTP local\r\n220 Ready\r\n");
            }
            return fd;
        },
        async read(fd,max) {
            const socket=sockets.get(fd);
            if(socket.port!==2121) {
                if(!socket.bytes || socket.offset>=socket.bytes.length) return new Uint8Array();
                const bytes=socket.bytes.slice(socket.offset,socket.offset+Math.min(3,max));
                socket.offset+=bytes.length; return bytes;
            }
            const bytes=socket.queue[0];
            assert(bytes,"control response should be queued");
            const n=Math.min(bytes.length,5,max), result=bytes.slice(0,n);
            socket.queue[0]=bytes.slice(n); if(!socket.queue[0].length)socket.queue.shift();
            return result;
        },
        async write(fd,bytes) {
            const socket=sockets.get(fd);
            if(socket.port!==2121){socket.output.push(bytes.slice());return;}
            const command=new TextDecoder().decode(bytes).trimEnd(); commands.push(command);
            const space=command.indexOf(" "), verb=space<0?command:command.slice(0,space), arg=command.slice(space+1);
            if(verb==="USER")queue(socket,"230 Logged in\r\n");
            else if(verb==="TYPE")queue(socket,"200 Binary\r\n");
            else if(verb==="PASV")queue(socket,options.badPort?"227 Passive (127,0,0,1,0,80)\r\n":"227 Passive (203,0,113,5,91,160)\r\n");
            else if(verb==="SIZE") {
                if(options.denied)queue(socket,"550 Permission denied\r\n");
                else queue(socket,files.has(arg)?"213 "+files.get(arg).length+"\r\n":"550 No such file or directory\r\n");
            } else if(verb==="RETR" || verb==="STOR") {
                const data=[...sockets.values()].find(s=>s.port!==2121);
                assert(data); data.control=socket;
                if(verb==="RETR")data.bytes=files.get(arg);else data.store=arg;
                queue(socket,"150 Opening transfer\r\n");
            } else if(verb==="RNFR") {socket.from=arg;queue(socket,"350 Ready\r\n");}
            else if(verb==="RNTO") {files.set(arg,files.get(socket.from));files.delete(socket.from);queue(socket,"226 Renamed\r\n");}
            else if(verb==="DELE") {files.delete(arg);queue(socket,"226 Deleted\r\n");}
            else throw new Error("unexpected "+command);
        },
        async close(fd) {
            const socket=sockets.get(fd);
            if(socket.port!==2121 && socket.control) {
                if(socket.store) {
                    const len=socket.output.reduce((n,b)=>n+b.length,0), bytes=new Uint8Array(len);let off=0;
                    socket.output.forEach(b=>{bytes.set(b,off);off+=b.length;});files.set(socket.store,bytes);
                }
                queue(socket.control,"226 Done\r\n");
            }
            sockets.delete(fd);
        }
    };
    return api;
}
(async()=>{
    const tcp=mock(), io=window.createAutoloadFTP(tcp);
    const text=await io.read("autoload.txt",65536);
    assert.equal(new TextDecoder().decode(text),"!500\nftpsrv-ps5.elf\n");
    assert.equal(tcp.sockets.size,0);
    const bytes=new Uint8Array([127,69,76,70,1,2,3]);
    await io.create("test.elf.tmp-123",bytes);
    assert.deepEqual(await io.read("test.elf.tmp-123",100),bytes);
    await assert.rejects(()=>io.create("test.elf.tmp-123",bytes),/temporal/);
    await io.rename("test.elf.tmp-123","test.elf");
    assert(tcp.files.has("/data/ps5_autoloader/test.elf"));
    await io.remove("test.elf");assert(!tcp.files.has("/data/ps5_autoloader/test.elf"));
    await assert.rejects(()=>io.read("autoload.txt",1),/grande/);
    await assert.rejects(()=>io.read("../outside",100),/inválido/);
    assert.equal(tcp.sockets.size,0);
    const deny=mock({denied:true});
    await assert.rejects(()=>window.createAutoloadFTP(deny).create("new.tmp",bytes),/Permission denied/);
    assert(!deny.commands.some(x=>x.startsWith("STOR")));assert.equal(deny.sockets.size,0);
    const badPort=mock({badPort:true});
    await assert.rejects(()=>window.createAutoloadFTP(badPort).read("autoload.txt",65536),/Puerto/);
    assert.equal(badPort.sockets.size,0);
    const page=fs.readFileSync("slopkit/poops.html","utf8");
    assert(page.includes("background:#0c0c0f; opacity:1"));
    assert(page.includes("-webkit-text-fill-color:#fff !important"));
    assert(page.includes('selected = ftp; return bytes'));
    const ui=fs.readFileSync("slopkit/autoload-ui.js","utf8");
    assert(ui.includes("repaint()") && ui.includes("panel.scrollTop = 0"));
    console.log("FTP tests passed: fragmented/multiline replies, binary transfers, scoped paths, passive port checks, staging collision protection, rename/delete and cleanup.");
})().catch(error=>{console.error(error);process.exitCode=1});
