// three.js's GLTFExporter was written for web browsers. To produce a binary .glb it hands a
// Blob to the browser's FileReader API. Node.js has Blob but not FileReader, so this file adds
// the single FileReader method the exporter calls (readAsArrayBuffer). Import it before the
// exporter is used.

if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class FileReader {
    constructor() {
      this.result = null;
      this.error = null;
      this.onloadend = null;
      this.onerror = null;
    }

    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then(
        (buffer) => {
          this.result = buffer;
          if (this.onloadend) this.onloadend();
        },
        (error) => {
          this.error = error;
          if (this.onerror) this.onerror(error);
          if (this.onloadend) this.onloadend();
        },
      );
    }
  };
}
