# RSP---Software-Radio-Studio-Pro
Programa Automatizador Radio 
# Automatizador de Radio (Electron + React + TypeScript)

Este es un automatizador de radio de código abierto y software libre.

## ⚖️ Licencia del Proyecto
Este software está distribuido bajo la licencia **GNU General Public License v3.0 (GPLv3)**. Eres libre de usarlo, estudiar su código, modificarlo y redistribuirlo, siempre y cuando mantengas las obras derivadas bajo esta misma licencia abierta.

---

## 🛠️ Requisito Obligatorio: Motor de Audio (BASS)

Para el procesamiento y la reproducción de audio de alta calidad, este software utiliza el motor **BASS Audio Library** corriendo de forma externa como un componente *sidecar*. 

Por motivos legales y de cumplimiento de licencias, **los binarios de BASS no están incluidos en este repositorio**.

### Cómo instalar el motor de audio:
1. Dirígete al sitio web oficial de [Un4seen Developments](https://un4seen.com).
2. Descarga la versión de la librería BASS correspondiente a tu sistema operativo (Windows, Linux o macOS).
3. Coloca los archivos descargados (como `bass.dll`, `libbass.so` o `libbass.dylib`) dentro de la carpeta `/bin/bass/` en la raíz de la aplicación instalada.

### ⚠️ Nota Legal Importante sobre BASS
* **Uso No Comercial:** BASS es completamente gratuito únicamente para individuos o entidades que desarrollen o utilicen el software sin fines de lucro.
* **Uso Comercial:** Si planeas utilizar este automatizador en una estación de radio comercial (con publicidad), dentro de una empresa, o si planeas generar ingresos de cualquier tipo con él, **eres responsable absoluto de adquirir una licencia comercial** directamente con Un4seen Developments. 
* El autor de este automatizador no se hace responsable por el uso indebido o no autorizado de la librería BASS por parte de terceros.
