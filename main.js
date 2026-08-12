#!/usr/bin/env node

const { program } = require('commander');
const { Poppler } = require('node-poppler');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const noble = require('@abandonware/noble');

// Constants
const DEFAULT_PRINT_WIDTH = 384;

const DEFAULT_TRIM = false;
const POPPLER_BIN_PATH = '/Users/victor/homebrew/bin';


// ED:07:03:13:33:E6
const PRINTER_NAMES = ['_ZZ00', 'GB01', 'GB02', 'GB03', 'GT01', 'MX05', 'MX06', 'MX08', 'MX09', 'YT01'];

// Configuration
const PRINT_WIDTH = 384;
const SCAN_TIMEOUT_S = 60;
const CHUNK_DELAY_MS = 20; // delay between BLE MTU-sized chunk transmissions
const DISCONNECT_AFTER_S = 60; // after printing disconnect after this amount of time
const ENABLE_COMPRESSION = false;

const GetDevState = 0xA3;
let transmit = true;

const status = {
    isReady: false,
    noPaper: false,
    isLidOpen: false,
    overtemp: false,
    lowBattery: false,
};

const XOff = [0x51, 0x78, 0xAE, 0x01, 0x01, 0x00, 0x10, 0x70, 0xFF];
const XOn = [0x51, 0x78, 0xAE, 0x01, 0x01, 0x00, 0x00, 0x00, 0xFF];


const CRC8_TABLE = [
    0x00, 0x07, 0x0e, 0x09, 0x1c, 0x1b, 0x12, 0x15, 0x38, 0x3f, 0x36, 0x31, 0x24, 0x23, 0x2a, 0x2d,
    0x70, 0x77, 0x7e, 0x79, 0x6c, 0x6b, 0x62, 0x65, 0x48, 0x4f, 0x46, 0x41, 0x54, 0x53, 0x5a, 0x5d,
    0xe0, 0xe7, 0xee, 0xe9, 0xfc, 0xfb, 0xf2, 0xf5, 0xd8, 0xdf, 0xd6, 0xd1, 0xc4, 0xc3, 0xca, 0xcd,
    0x90, 0x97, 0x9e, 0x99, 0x8c, 0x8b, 0x82, 0x85, 0xa8, 0xaf, 0xa6, 0xa1, 0xb4, 0xb3, 0xba, 0xbd,
    0xc7, 0xc0, 0xc9, 0xce, 0xdb, 0xdc, 0xd5, 0xd2, 0xff, 0xf8, 0xf1, 0xf6, 0xe3, 0xe4, 0xed, 0xea,
    0xb7, 0xb0, 0xb9, 0xbe, 0xab, 0xac, 0xa5, 0xa2, 0x8f, 0x88, 0x81, 0x86, 0x93, 0x94, 0x9d, 0x9a,
    0x27, 0x20, 0x29, 0x2e, 0x3b, 0x3c, 0x35, 0x32, 0x1f, 0x18, 0x11, 0x16, 0x03, 0x04, 0x0d, 0x0a,
    0x57, 0x50, 0x59, 0x5e, 0x4b, 0x4c, 0x45, 0x42, 0x6f, 0x68, 0x61, 0x66, 0x73, 0x74, 0x7d, 0x7a,
    0x89, 0x8e, 0x87, 0x80, 0x95, 0x92, 0x9b, 0x9c, 0xb1, 0xb6, 0xbf, 0xb8, 0xad, 0xaa, 0xa3, 0xa4,
    0xf9, 0xfe, 0xf7, 0xf0, 0xe5, 0xe2, 0xeb, 0xec, 0xc1, 0xc6, 0xcf, 0xc8, 0xdd, 0xda, 0xd3, 0xd4,
    0x69, 0x6e, 0x67, 0x60, 0x75, 0x72, 0x7b, 0x7c, 0x51, 0x56, 0x5f, 0x58, 0x4d, 0x4a, 0x43, 0x44,
    0x19, 0x1e, 0x17, 0x10, 0x05, 0x02, 0x0b, 0x0c, 0x21, 0x26, 0x2f, 0x28, 0x3d, 0x3a, 0x33, 0x34,
    0x4e, 0x49, 0x40, 0x47, 0x52, 0x55, 0x5c, 0x5b, 0x76, 0x71, 0x78, 0x7f, 0x6a, 0x6d, 0x64, 0x63,
    0x3e, 0x39, 0x30, 0x37, 0x22, 0x25, 0x2c, 0x2b, 0x06, 0x01, 0x08, 0x0f, 0x1a, 0x1d, 0x14, 0x13,
    0xae, 0xa9, 0xa0, 0xa7, 0xb2, 0xb5, 0xbc, 0xbb, 0x96, 0x91, 0x98, 0x9f, 0x8a, 0x8d, 0x84, 0x83,
    0xde, 0xd9, 0xd0, 0xd7, 0xc2, 0xc5, 0xcc, 0xcb, 0xe6, 0xe1, 0xe8, 0xef, 0xfa, 0xfd, 0xf4, 0xf3
];

// Messages

// looks like this moves paper by 2x so 32 moves paper by 64 pixels
function msgRetractPaper(pixels) {
    return formatMessage(0xA0, intTo2bytes(pixels));
}

// looks like this moves paper by 2x so 32 moves paper by 64 pixels
function msgFeedPaper(pixels) {
    return formatMessage(0xA1, intTo2bytes(pixels));
}

const MSG_GET_DEV_STATE = () => formatMessage(0xA3); // reply by notification
const MSG_SET_QUALITY_200_DPI = () => formatMessage(0xA4, [50, 0x9E]);
const MSG_LATTICE_START = () => formatMessage(0xA6, [0xAA, 0x55, 0x17, 0x38, 0x44, 0x5F, 0x5F, 0x5F, 0x44, 0x38, 0x2C, 0xA1]);
const MSG_LATTICE_END = () => formatMessage(0xA6, [0xAA, 0x55, 0x17, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x17, 0x11]);
const MSG_GET_DEV_INFO = () => formatMessage(0xA8);
const MSG_PRINT_IMG = () => formatMessage(0xBE, [0x00]);
const MSG_PRINT_TEXT = () => formatMessage(0xBE, [0x01, 0x07]);

/**
    Set how quick to feed/retract paper. **The lower, the quicker.**
    My printer with value < 4 set would make it unable to feed/retract,
    maybe it's way too quick.
    Speed also affects the quality, for heat time/stability reasons.
 */
function msgSetSpeed(x) {
    return formatMessage(0xBD, [x & 0xFF]);
}

// 0 - ffff
function msgSetEnergy(val) {
    return formatMessage(0xAF, intTo2bytes(val));
}

function crc8(data) {
    let crc = 0;
    for (const byte of data) {
        crc = CRC8_TABLE[(crc ^ byte) & 0xFF];
    }
    return crc & 0xFF;
}

/**
 * Formats a message according to a specific protocol.
 * @param {number} command - The command byte.
 * @param {number[]} [data=[]] - An array of data bytes to include in the message.
 * @returns {Buffer} - The formatted message as a Buffer.
 */
function formatMessage(command, data = []) {
    const message = [
        0x51, 0x78,       // Magic number: 2 bytes (0x51, 0x78)
        command,          // Command: 1 byte
        0x00,             // Reserved byte
        data.length,      // Data length: 1 byte
        0x00,             // Reserved byte
        ...data,          // Data: variable length (based on Data Length)
        crc8(data),       // CRC8 of Data: 1 byte
        0xFF              // Terminator: 1 byte (0xFF)
    ];
    return Buffer.from(message);
}


function intTo2bytes(x) {
    return [x & 0xFF, (x >> 8) & 0xFF];
}

function intTo2BytesBE(x) {
    return [(x >> 8) & 0xFF, x & 0xFF];
}

function msgPrintRow(bitArray) {
    const rleCompressedRow = compressRLE(bitArray);
    if (rleCompressedRow.length < bitArray.length / 8) {
        return formatMessage(0xBF, rleCompressedRow);
    }

    const byteEncodedRow = byteEncode(bitArray);
    return formatMessage(0xA2, byteEncodedRow);
}

/**
 * Encodes a run of repeated values using run-length encoding.
 * Splits the run into chunks that fit 7-bit limits and prepends the value.
 * @param {number} n - Repetition count.
 * @param {number} val - Value to encode.
 * @returns {number[]} - Run-length encoded output.
 */
function encodeRunLengthRepetition(n, val) {
    const res = [];
    while (n > 127) {
        res.push(127 | (val << 7));
        n -= 127;
    }
    if (n > 0) {
        res.push((val << 7) | n);
    }
    return res;
}

/**
 * Run-length encodes an array of values.
 * Compresses input by encoding consecutive identical values.
 * @param {number[]} imgRow - Input array.
 * @returns {number[]} - Run-length encoded array.
 */
function compressRLE(imgRow) {
    const res = [];
    let count = 0;
    let lastVal = -1;
    imgRow.forEach(val => {
        if (val === lastVal) {
            count++;
        } else {
            res.push(...encodeRunLengthRepetition(count, lastVal));
            count = 1;
        }
        lastVal = val;
    });
    if (count > 0) {
        res.push(...encodeRunLengthRepetition(count, lastVal));
    }
    return res;
}

/**
 * Encodes a bit array into a byte array grouping 8 bits from the input array into each byte, LSB first.
 * @param {boolean[]} bitArray - Array of bits (0s and 1s).
 * @returns {number[]} - Array of bytes representing the bit array.
 */
function byteEncode(bitArray) {
    const res = [];
    for (let i = 0; i < bitArray.length; i += 8) {
        let byte = 0;
        for (let bitIndex = 0; bitIndex < 8; bitIndex++) {
            byte |= bitArray[i + bitIndex] << bitIndex;
        }
        res.push(byte);
    }
    return res;
}

function chunkify(data, chunkSize) {
    const chunks = [];
    for (let i = 0; i < data.length; i += chunkSize) {
        chunks.push(data.slice(i, i + chunkSize));
    }
    return chunks;
}

function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}






async function pdfToImages(pdfPath, outputDir) {
    try {
        const poppler = new Poppler(POPPLER_BIN_PATH);

        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const options = {
            pngFile: true,
            cropBox: false,
            singleFile: false,
            jpegFile: false,
            resolutionXYAxis: 300,
            antialias: 'default',
        };

        const outputFileTemplate = path.join(outputDir, 'page-%d.png');
        await poppler.pdfToCairo(pdfPath, outputFileTemplate, options);
        console.log('PDF converted to images successfully.');

    } catch (error) {
        console.error('Error converting PDF to images:', error);
    }
}




async function preprocessAndDither(inputPath, outputPath, trim = DEFAULT_TRIM, autoRotate = true) {
    try {
        const metadata = await sharp(inputPath).metadata();
        let image = sharp(inputPath);

        // Trim empty margins
        if (trim) {
            image = image.trim();
        }

        // Auto rotate
        if (autoRotate && metadata.width > DEFAULT_PRINT_WIDTH && metadata.width > metadata.height) {
            image = image.rotate(90);
        }

        const { data, info } = await image
            // fit to width
            .resize({
                width: DEFAULT_PRINT_WIDTH,
                height: null,
                fit: sharp.fit.inside,
                withoutEnlargement: true,
            })
            // padding if image is smaller than page
            .extend({
                top: 0,
                bottom: 0,
                left: Math.floor((DEFAULT_PRINT_WIDTH - Math.min(metadata.width, DEFAULT_PRINT_WIDTH)) / 2),
                right: Math.ceil((DEFAULT_PRINT_WIDTH - Math.min(metadata.width, DEFAULT_PRINT_WIDTH)) / 2),
                background: { r: 255, g: 255, b: 255, alpha: 1 },
            })
            .greyscale()
            .raw()
            .toBuffer({ resolveWithObject: true });

        const width = info.width;
        const height = info.height;
        const ditheredData = Buffer.from(data);

        // Masking dittering artifacts on white backgrounds
        const whiteMask = new Uint8Array(data.length);
        for (let i = 0; i < data.length; i++) {
            whiteMask[i] = data[i] > 240 ? 1 : 0;
            if (whiteMask[i]) {
                ditheredData[i] = 255;
            }
        }

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const index = y * width + x;

                if (whiteMask[index] === 1) {
                    continue;
                }

                const oldPixel = ditheredData[index];
                const newPixel = oldPixel < 128 ? 0 : 255;
                ditheredData[index] = newPixel;
                const quantError = oldPixel - newPixel;

                if (x + 1 < width && whiteMask[index + 1] === 0) {
                    ditheredData[index + 1] = clamp(ditheredData[index + 1] + (quantError * 7) / 16);
                }
                if (x - 1 >= 0 && y + 1 < height && whiteMask[index + width - 1] === 0) {
                    ditheredData[index + width - 1] = clamp(ditheredData[index + width - 1] + (quantError * 3) / 16);
                }
                if (y + 1 < height && whiteMask[index + width] === 0) {
                    ditheredData[index + width] = clamp(ditheredData[index + width] + (quantError * 5) / 16);
                }
                if (x + 1 < width && y + 1 < height && whiteMask[index + width + 1] === 0) {
                    ditheredData[index + width + 1] = clamp(ditheredData[index + width + 1] + (quantError * 1) / 16);
                }
            }
        }

        await sharp(ditheredData, { raw: { width: width, height: height, channels: 1 } })
            .toFormat('png')
            .toFile(outputPath);

        console.log(`Dithered image saved as ${outputPath}`);
    } catch (error) {
        console.error(`Error processing image ${inputPath}:`, error);
    }
}

function handleNotification(data) {
    if (Buffer.compare(data, Buffer.from(XOff)) === 0) {
        console.log("Pausing transmission.");
        transmit = false;
    } else if (Buffer.compare(data, Buffer.from(XOn)) === 0) {
        console.log("Resuming transmission.");
        transmit = true;
    } else if (data[2] === GetDevState) {
        const statusByte = data[6];
        status.isReady = statusByte === 0b00000000;
        status.noPaper = (statusByte & 0b00000001) !== 0;
        status.isLidOpen = (statusByte & 0b00000010) !== 0;
        status.overtemp = (statusByte & 0b00000100) !== 0;
        status.lowBattery = (statusByte & 0b00001000) !== 0;

        console.log('status changed', status);
    }
}

async function runBLE() {
    try {
        await noble.startScanningAsync([], false);

        const peripheral = await new Promise((resolve, reject) => {
            noble.on('discover', (peripheral) => {
                if (PRINTER_NAMES.includes(peripheral.advertisement.localName)) {
                    noble.stopScanningAsync();
                    resolve(peripheral);
                }
            });
            setTimeout(() => reject(new Error('Unable to find printer, make sure it is turned on and in range')), SCAN_TIMEOUT_S * 1000);
        });

        console.log(`✅ Found printer: ${peripheral.advertisement.localName} (${peripheral.address}) ${peripheral.rssi}dB`);

        console.log('Connecting...');
        await peripheral.connectAsync();
        console.log('Connected!');

        const { characteristics } = await peripheral.discoverAllServicesAndCharacteristicsAsync([], []);
        const characteristic = characteristics[0];
        const chunkSize = (characteristic.mtu || 248) - 3;

        characteristics.forEach((characteristic, i) => {
            characteristic.subscribe(async (err) => {
                if (err) {
                    console.error('Failed to subscribe to notifications.', i, err);
                    return;
                }
                characteristic.on('data', function (data, b) {
                    console.log('Received Data', i, data, b);
                    handleNotification(data);
                });
            });
        });

        // setInterval(async () => {
        //     let r;
        //     r = await characteristic.writeAsync(MSG_GET_DEV_STATE(), true);
        //     await delay(500);
        //     r = await characteristic.writeAsync(MSG_GET_DEV_STATE(), false);
        //     await delay(500);
        //     r = await characteristic.writeAsync(MSG_GET_DEV_INFO(), true);
        //     await delay(500);
        //     r = await characteristic.writeAsync(MSG_GET_DEV_INFO(), false);
        //     await delay(500);
        // }, 5000);

        const send = async (data) => {
            console.log(`⏳ Sending ${data.length} bytes of data in chunks of ${chunkSize} bytes...`);
            const chunks = chunkify(data, chunkSize);
            for (const chunk of chunks) {
                while (!transmit) {
                    await delay(100);
                }
                await characteristic.writeAsync(chunk, true);
                await delay(CHUNK_DELAY_MS);
            }
            console.log(`✅ Done.`);
            await delay(CHUNK_DELAY_MS);
        };

        const disconnect = async () => {
            if (peripheral.state === 'connected') {
                await peripheral.disconnectAsync();
                console.log('Disconnected.');
            }
        };

        return { send, disconnect };
    } catch (err) {
        console.error(`🛑 ${err.message}`, err);
    }
}

function msgsPrintImg(pixelBitMatrix, textMode = false, strength = 0x9000) {
    const PRINTER_MODE = textMode ? MSG_PRINT_TEXT() : MSG_PRINT_IMG();

    const data = [];

    data.push(
        MSG_GET_DEV_STATE(),
        PRINTER_MODE,
        msgSetEnergy(strength),
    );

    // image
    data.push(MSG_LATTICE_START());
    pixelBitMatrix.forEach(row => {
        data.push(msgPrintRow(row));
    });
    data.push(MSG_LATTICE_END());

    data.push(
        msgFeedPaper(10),
        MSG_GET_DEV_STATE()
    );

    return Buffer.concat(data);
}


function clamp(value) {
    return Math.max(0, Math.min(255, value));
}


async function main() {
    program
        .arguments('<input>')
        .option('-p, --preview', 'Show preview of intermediate images', false)
        .option('-t, --trim', 'Enable trimming of images', DEFAULT_TRIM)
        .option('-w, --width <width>', 'Set print width', DEFAULT_PRINT_WIDTH)
        .option('-b, --img-binarization-algo <algo>', 'Image binarization algorithm', 'floyd-steinberg')
        .option('-d, --dry', 'Dry run: do everything but print', false)
        .action(async (input, options) => {
            
            const { preview, trim, width, imgBinarizationAlgo, dry } = options;
            const outputDir = path.join(__dirname, 'output');
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir);
            }

            let images = [];
            if (input.toLowerCase().endsWith('.pdf')) {
                await pdfToImages(input, outputDir);
                images = fs.readdirSync(outputDir)
                    .filter(file => file.startsWith('page-') && file.endsWith('.png'))
                    .map(file => path.join(outputDir, file));
            } else {
                images = [input];
            }

            for (const image of images) {
                const outputPath = path.join(outputDir, `processed_${path.basename(image)}`);
                await preprocessAndDither(image, outputPath, trim);

                if (preview) {
                    console.log(`Preview available at ${outputPath}`);
                }

                // Binarize image using Sharp (no Jimp)
                const { data: imgBuffer, info } = await sharp(outputPath)
                    .greyscale()
                    .raw()
                    .toBuffer({ resolveWithObject: true });
                const { width, height } = info;
                const binarizedImg = [];

                for (let y = 0; y < height; y++) {
                    const row = [];
                    for (let x = 0; x < width; x++) {
                        const idx = y * width + x;
                        // In the MX06 protocol, a 1 bit activates (burns) a dot.
                        row.push(imgBuffer[idx] < 128 ? 1 : 0);
                    }
                    binarizedImg.push(row);
                }

                // The X6/MX06 firmware expects a blank first scanline; without it,
                // some units introduce artifacts at the beginning of a print.
                binarizedImg.unshift(new Array(width).fill(0));

                const data = msgsPrintImg(binarizedImg, true, 0xfff * 0);
                
                if (!dry) {
                    const printer = await runBLE();
                    if (!printer) {
                        throw new Error('Could not connect to the printer.');
                    }

                    try {
                        const power = 0.6;
                        const printData = msgsPrintImg(binarizedImg, false, 0xffff * power | 0);
                        await printer.send(printData);
                        await delay(2000);
                        await printer.send(msgFeedPaper(55));
                    } finally {
                        await printer.disconnect();
                    }
                } else {
                    console.log(`Dry run: Skipping printing process for ${path.basename(image)}`);
                }
            }
        });

    program.parse(process.argv);
}

main();
