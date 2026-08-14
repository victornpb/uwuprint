const CRC8_POLYNOMIAL = 0x07;

function crc8(data) {
    let crc = 0;
    for (const byte of data) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) {
            crc = (crc & 0x80) ? ((crc << 1) ^ CRC8_POLYNOMIAL) : (crc << 1);
        }
        crc &= 0xff;
    }
    return crc;
}

function formatMessage(command, data = []) {
    return Uint8Array.from([0x51, 0x78, command, 0x00, data.length, 0x00, ...data, crc8(data), 0xff]);
}

function intTo2bytes(value) {
    return [value & 0xff, (value >> 8) & 0xff];
}

function encodeRunLengthRepetition(count, value) {
    const encoded = [];
    while (count > 127) {
        encoded.push(127 | (value << 7));
        count -= 127;
    }
    if (count > 0) encoded.push((value << 7) | count);
    return encoded;
}

function compressRLE(row) {
    const encoded = [];
    let count = 0;
    let previous = -1;
    for (const pixel of row) {
        if (pixel === previous) count++;
        else {
            encoded.push(...encodeRunLengthRepetition(count, previous));
            previous = pixel;
            count = 1;
        }
    }
    encoded.push(...encodeRunLengthRepetition(count, previous));
    return encoded;
}

function byteEncode(row) {
    const encoded = [];
    for (let i = 0; i < row.length; i += 8) {
        let byte = 0;
        for (let bit = 0; bit < 8; bit++) byte |= row[i + bit] << bit;
        encoded.push(byte);
    }
    return encoded;
}

function printRow(row, compression = 'auto') {
    const rle = compressRLE(row);
    const useCompression = compression === 'on' ||
        (compression !== 'off' && rle.length < row.length / 8);
    return formatMessage(useCompression ? 0xbf : 0xa2, useCompression ? rle : byteEncode(row));
}

export function buildPrintData(pixelRows, strength = 0x9998, options = {}) {
    const packets = [
        formatMessage(0xa3),
        formatMessage(0xbe, [0x00]),
    ];
    if (Number.isInteger(options.quality) && options.quality >= 1 && options.quality <= 5) {
        packets.push(formatMessage(0xa4, [0x30 + options.quality]));
    }
    if (Number.isInteger(options.speed) && options.speed >= 1 && options.speed <= 255) {
        packets.push(formatMessage(0xbd, [options.speed]));
    }
    packets.push(
        formatMessage(0xaf, intTo2bytes(strength)),
        formatMessage(0xa6, [0xaa, 0x55, 0x17, 0x38, 0x44, 0x5f, 0x5f, 0x5f, 0x44, 0x38, 0x2c, 0xa1]),
        ...pixelRows.map((row) => printRow(row, options.compression)),
        formatMessage(0xa6, [0xaa, 0x55, 0x17, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x17, 0x11]),
        formatMessage(0xa3),
    );
    const length = packets.reduce((sum, packet) => sum + packet.length, 0);
    const output = new Uint8Array(length);
    let offset = 0;
    for (const packet of packets) {
        output.set(packet, offset);
        offset += packet.length;
    }
    return output;
}

export function buildFeedData(pixels) {
    return formatMessage(0xa1, intTo2bytes(pixels));
}

export function buildRetractData(pixels) {
    return formatMessage(0xa0, intTo2bytes(pixels));
}

export function buildStatusRequest() {
    return formatMessage(0xa3);
}

export const flowControl = {
    pause: Uint8Array.from([0x51, 0x78, 0xae, 0x01, 0x01, 0x00, 0x10, 0x70, 0xff]),
    resume: Uint8Array.from([0x51, 0x78, 0xae, 0x01, 0x01, 0x00, 0x00, 0x00, 0xff]),
};
