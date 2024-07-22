const events = require('events');
const JSZip = require('jszip');
const yazl = require('yazl');

const {PassThrough} = require('stream');
const StreamBuf = require('./stream-buf');
const {stringToBuffer} = require('./browser-buffer-encode');

// =============================================================================
// The ZipWriter class
// Packs streamed data into an output zip stream
class ZipWriter extends events.EventEmitter {
  constructor(options) {
    super();
    this.options = Object.assign(
      {
        type: 'nodebuffer',
        compression: 'DEFLATE',
      },
      options
    );

    if (process.browser) {
      this.zip = new JSZip();

      this.stream = new StreamBuf();
    } else {
      this.zip = new yazl.ZipFile();
      this.stream = new PassThrough();
    }
  }

  append(data, options) {
    if (process.browser) {
      if (options.hasOwnProperty('base64') && options.base64) {
        this.zip.file(options.name, data, {base64: true});
      } else {
        // https://www.npmjs.com/package/process
        if (process.browser && typeof data === 'string') {
          // use TextEncoder in browser
          data = stringToBuffer(data);
        }
        this.zip.file(options.name, data);
      }
    } else {
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
      this.zip.addBuffer(buffer, options.name, {
        compress: options.compress || true,
      });
    }
  }

  appendXMLParts(parts, options) {
    if (process.browser) {
      this.append(parts.join(''), options);
    } else {
      try {
        const full = parts.join('');
        this.append(full, options);
      } catch (error) {
        // check to see if it is a invalid string meaning we need to write them all individually to prevent error
        if (
          !error ||
          !error.toString() ||
          !error.toString().includes('RangeError: Invalid string length')
        )
          throw error;
        const passThrough = new PassThrough();
        passThrough.setMaxListeners(100);
        this.zip.addReadStream(passThrough, options.name);

        const writeParts = async () => {
          const drainPromises = [];
          for (const part of parts) {
            if (!passThrough.write(part)) {
              drainPromises.push(new Promise(resolve => passThrough.once('drain', resolve)));
              // once we are reaching max listeners, drain
              if (drainPromises.length >= 100) {
                /* eslint-disable no-await-in-loop */
                await Promise.all(drainPromises);
                drainPromises.length = 0;
              }
            }
          }
          if (drainPromises.length > 0) await Promise.all(drainPromises);
          passThrough.end();
        };

        writeParts().catch(err => {
          passThrough.emit('error', err);
        });
      }
    }
  }

  async finalize() {
    return new Promise((resolve, reject) => {
      if (process.browser) {
        this.zip
          .generateAsync(this.options)
          .then(content => {
            this.stream.end(content);
            this.emit('finish');
            resolve();
          })
          .catch(err => {
            this.emit('error', err);
            reject(err);
          });
      } else {
        this.zip.end();
        this.zip.outputStream.on('end', () => {
          this.stream.end();
          this.emit('finish'); // Notify listeners that the zip is complete
          resolve(); // Resolve the promise to let callers continue
        });

        this.zip.outputStream.on('error', err => {
          this.emit('error', err); // Notify listeners about the error
          reject(err); // Reject the promise to handle the error
        });

        this.zip.outputStream.pipe(this.stream).on('error', err => {
          this.emit('error', err); // Also handle piping errors
          reject(err);
        });
      }
    });
  }

  // ==========================================================================
  // Stream.Readable interface
  read(size) {
    return this.stream.read(size);
  }

  setEncoding(encoding) {
    return this.stream.setEncoding(encoding);
  }

  pause() {
    return this.stream.pause();
  }

  resume() {
    return this.stream.resume();
  }

  isPaused() {
    return this.stream.isPaused();
  }

  pipe(destination, options) {
    return this.stream.pipe(destination, options);
  }

  unpipe(destination) {
    return this.stream.unpipe(destination);
  }

  unshift(chunk) {
    return this.stream.unshift(chunk);
  }

  wrap(stream) {
    return this.stream.wrap(stream);
  }
}

// =============================================================================

module.exports = {
  ZipWriter,
};
