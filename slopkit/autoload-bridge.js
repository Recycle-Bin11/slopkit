(function (root) {
"use strict";
root.createAutoloadBridge = function (tcp, launch) {
    let fd = null, initialized = false;
    const MAGIC = 0x31414c53, encoder = new TextEncoder();
    async function dispose() {
        initialized=false;
        if (fd!==null) { const closing=fd;fd=null;await tcp.close(closing); }
    }
    async function exact(size) {
        const out=new Uint8Array(size);let off=0,attempts=0;
        while(off<size) {
            if(++attempts>8192)throw new Error("Respuesta del auxiliar incompleta.");
            const bytes=await tcp.read(fd,Math.min(65536,size-off));
            if(!bytes.length || bytes.length>size-off)throw new Error("El auxiliar cerró la conexión.");
            out.set(bytes,off);off+=bytes.length;
        }
        return out;
    }
    async function request(op,name,arg,body) {
        const nameBytes=encoder.encode(name);
        const header=new Uint8Array(16+nameBytes.length);
        const view=new DataView(header.buffer);
        view.setUint32(0,MAGIC,true);view.setUint32(4,op,true);
        view.setUint32(8,nameBytes.length,true);view.setUint32(12,arg,true);
        header.set(nameBytes,16);
        try {
            await tcp.write(fd,header);
            if(body && body.length)await tcp.write(fd,body);
            const response=await exact(16),data=new DataView(response.buffer);
            const error=data.getUint32(4,true),size=data.getUint32(8,true);
            if(data.getUint32(0,true)!==MAGIC || size>4194304)
                throw new Error("Respuesta inválida del auxiliar.");
            if(error)throw new Error("Auxiliar PS5: errno "+error
                + (error===2 ? " (archivo o carpeta no existe)" : error===13 ? " (permiso denegado)" : "")
                + ". Ruta: /data/ps5_autoloader/"+name);
            if(size>(op===1?arg:op===0?64:0))throw new Error("El auxiliar excedió el límite de respuesta.");
            return await exact(size);
        } catch(error) {
            await dispose();
            throw error;
        }
    }
    async function init() {
        if(initialized)return;
        await launch();
        let lastError=null;
        for(let attempt=0;attempt<20;attempt++) {
            try {fd=await tcp.connect(9025);break;}
            catch(error) {lastError=error;await new Promise(r=>setTimeout(r,250));}
        }
        if(fd===null)throw new Error("No inició el auxiliar. "+(lastError?lastError.message:""));
        const hello=await request(0,"",0);
        if(new TextDecoder().decode(hello)!=="slopkit-autoload-v1") {
            await dispose();throw new Error("Versión del auxiliar incompatible.");
        }
        initialized=true;
    }
    function name(value) {
        if(typeof value!=="string" || value.length>250 || value.includes("..")
            || !/^[A-Za-z0-9][A-Za-z0-9 _().+-]*$/.test(value))throw new Error("Nombre de archivo inválido.");
        return value;
    }
    return {
        mode:()=> "auxiliar ELF (sin FTP)",
        dispose,
        async read(file,max) {
            name(file);
            if(!Number.isInteger(max)||max<1||max>4194304)throw new Error("Límite inválido.");
            await init();return request(1,file,max);
        },
        async create(file,bytes) {
            name(file);
            if(!initialized)throw new Error("Volvé a leer la configuración.");
            if(bytes.length>4194304)throw new Error("Archivo demasiado grande.");
            return request(2,file,bytes.length,bytes);
        },
        async rename(from,to) {
            name(from);name(to);
            if(!initialized)throw new Error("Volvé a leer la configuración.");
            const body=encoder.encode(to);return request(3,from,body.length,body);
        },
        async remove(file) {
            name(file);if(!initialized)throw new Error("Volvé a leer la configuración.");
            return request(4,file,0);
        }
    };
};
})(window);
