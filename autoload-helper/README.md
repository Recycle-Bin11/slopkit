# Autoload editor helper

El menú principal abre **Editar autoload**, debajo de **Payloads Sender**. Con jailbreak y el cargador ELF en 9021 activos, la página envía automáticamente `autoload-editor-helper.elf` y abre una sesión local en 127.0.0.1:9025. No requiere ftpsrv.

El auxiliar sólo permite leer autoload.txt/ELF, crear temporales y copias de seguridad, renombrar temporales y quitar ELF dentro de /data/ps5_autoloader. Rechaza rutas externas, archivos no regulares y enlaces simbólicos de lectura. No ejecuta payloads ni cambia credenciales. El TXT se guarda con copia de seguridad y reemplazo atómico; los ELF deseleccionados se eliminan después de verificar el TXT guardado.

Acepta una única conexión y cierra el listener inmediatamente. Termina al cerrar el editor o tras 15 minutos sin solicitudes; espera como máximo 60 segundos una conexión inicial. Una conexión local de otro proceso podría ocupar esa sesión: el protocolo no proporciona autenticación entre procesos de la consola.

Build: SDK oficial ps5-payload-dev v0.42, hash verificado, LLVM 18. `build.json` registra commit de fuente y SHA-256 del ELF publicado. El workflow compila la versión PS5 y ejecuta el mismo servidor C en Linux contra el cliente JS real (lectura, guardado, copia de ELF, respaldo, eliminación, reconexión, colisiones y enlaces simbólicos). La prueba en consola sigue siendo necesaria para confirmar la carga nativa y los permisos en cada firmware.

`AUTOLOAD_HOST_TEST` sólo habilita raíz/puerto configurables para pruebas en Linux; el ELF PS5 usa siempre la ruta y puerto fijos.
