const clamp = (value, min = 0, max = 255) => Math.max(min, Math.min(max, value));

const BAYER_4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

const HALFTONE_4 = [
  [12, 5, 6, 13],
  [4, 0, 1, 7],
  [11, 3, 2, 8],
  [15, 10, 9, 14],
];

const DIFFUSION_KERNELS = {
  "floyd-steinberg": {
    divisor: 16,
    rows: [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]],
  },
  "jarvis-judice-ninke": {
    divisor: 48,
    rows: [
      [1, 0, 7], [2, 0, 5],
      [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3],
      [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1],
    ],
  },
  stucki: {
    divisor: 42,
    rows: [
      [1, 0, 8], [2, 0, 4],
      [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2],
      [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1],
    ],
  },
  burkes: {
    divisor: 32,
    rows: [
      [1, 0, 8], [2, 0, 4],
      [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2],
    ],
  },
  sierra: {
    divisor: 32,
    rows: [
      [1, 0, 5], [2, 0, 3],
      [-2, 1, 2], [-1, 1, 4], [0, 1, 5], [1, 1, 4], [2, 1, 2],
      [-1, 2, 2], [0, 2, 3], [1, 2, 2],
    ],
  },
  "two-row-sierra": {
    divisor: 16,
    rows: [
      [1, 0, 4], [2, 0, 3],
      [-2, 1, 1], [-1, 1, 2], [0, 1, 3], [1, 1, 2], [2, 1, 1],
    ],
  },
  "sierra-lite": {
    divisor: 4,
    rows: [[1, 0, 2], [-1, 1, 1], [0, 1, 1]],
  },
};

function quantize(value, threshold = 128) {
  return value < threshold ? 0 : 255;
}

function ordered(input, width, height, matrix) {
  const output = Buffer.alloc(input.length);
  const size = matrix.length;
  const levels = size * size;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const threshold = ((matrix[y % size][x % size] + 0.5) * 255) / levels;
      output[y * width + x] = quantize(input[y * width + x], threshold);
    }
  }
  return output;
}

function errorDiffusion(input, width, height, kernel, options = {}) {
  const output = Buffer.from(input);
  const serpentine = options.serpentine !== false;
  for (let y = 0; y < height; y++) {
    const reverse = serpentine && y % 2 === 1;
    const start = reverse ? width - 1 : 0;
    const end = reverse ? -1 : width;
    const step = reverse ? -1 : 1;
    for (let x = start; x !== end; x += step) {
      const index = y * width + x;
      const oldPixel = output[index];
      const newPixel = quantize(oldPixel);
      output[index] = newPixel;
      const error = oldPixel - newPixel;
      for (const [offsetX, offsetY, weight] of kernel.rows) {
        const targetX = x + (reverse ? -offsetX : offsetX);
        const targetY = y + offsetY;
        if (targetX >= 0 && targetX < width && targetY < height) {
          const target = targetY * width + targetX;
          output[target] = clamp(output[target] + (error * weight) / kernel.divisor);
        }
      }
    }
  }
  return output;
}

function randomDither(input, seed = 0x12345678) {
  const output = Buffer.alloc(input.length);
  let state = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    output[i] = quantize(input[i], (state / 0x100000000) * 255);
  }
  return output;
}

function patternDither(input, width, height) {
  return ordered(input, width, height, HALFTONE_4);
}

function voidAndCluster(input, width, height) {
  // A blue-noise-like 8x8 rank pattern, suitable for deterministic printing.
  const matrix = [
    [0, 48, 12, 60, 3, 51, 15, 63],
    [32, 16, 44, 28, 35, 19, 47, 31],
    [8, 56, 4, 52, 11, 59, 7, 55],
    [40, 24, 36, 20, 43, 27, 39, 23],
    [2, 50, 14, 62, 1, 49, 13, 61],
    [34, 18, 46, 30, 33, 17, 45, 29],
    [10, 58, 6, 54, 9, 57, 5, 53],
    [42, 26, 38, 22, 41, 25, 37, 21],
  ];
  return ordered(input, width, height, matrix);
}

function riemersma(input, width, height) {
  // Hilbert traversal limits error feedback to a local path.
  const output = Buffer.from(input);
  const size = 2 ** Math.ceil(Math.log2(Math.max(width, height)));
  const points = [];
  function visit(x, y, length, ax, ay, bx, by) {
    if (length <= 0) return;
    if (length === 1) {
      if (x < width && y < height) points.push([x, y]);
      return;
    }
    const half = length / 2;
    visit(x, y, half, by / 2, bx / 2, ay / 2, ax / 2);
    visit(x + ax * half / 2, y + ay * half / 2, half, ax / 2, ay / 2, bx / 2, by / 2);
    visit(x + ax * half / 2 + bx * half / 2, y + ay * half / 2 + by * half / 2, half, ax / 2, ay / 2, bx / 2, by / 2);
    visit(x + ax * half / 2 + bx * half, y + ay * half / 2 + by * half, half, -by / 2, -bx / 2, -ay / 2, -ax / 2);
  }
  visit(0, 0, size, size, 0, 0, size);
  let error = 0;
  for (const [x, y] of points) {
    const index = y * width + x;
    const oldPixel = clamp(output[index] + error);
    const newPixel = quantize(oldPixel);
    output[index] = newPixel;
    error = (oldPixel - newPixel) * 0.75;
  }
  // Non-square dimensions can leave padding cells outside the Hilbert path.
  for (let i = 0; i < output.length; i++)
    if (output[i] !== 0 && output[i] !== 255) output[i] = quantize(output[i]);
  return output;
}

function atkinson(input, width, height) {
  return errorDiffusion(input, width, height, {
    divisor: 8,
    rows: [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]],
  });
}

function gradientBased(input, width, height) {
  const output = Buffer.from(input);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const left = output[y * width + Math.max(0, x - 1)];
      const right = output[y * width + Math.min(width - 1, x + 1)];
      const up = output[Math.max(0, y - 1) * width + x];
      const down = output[Math.min(height - 1, y + 1) * width + x];
      const gradient = Math.min(1, (Math.abs(right - left) + Math.abs(down - up)) / 510);
      const kernel = { divisor: 16, rows: [[1, 0, 7 * (1 - gradient)], [-1, 1, 3], [0, 1, 5], [1, 1, 1]] };
      const oldPixel = output[index];
      const newPixel = quantize(oldPixel);
      output[index] = newPixel;
      const error = oldPixel - newPixel;
      for (const [offsetX, offsetY, weight] of kernel.rows) {
        const targetX = x + offsetX;
        const targetY = y + offsetY;
        if (targetX >= 0 && targetX < width && targetY < height)
          output[targetY * width + targetX] = clamp(output[targetY * width + targetX] + error * weight / kernel.divisor);
      }
    }
  }
  return output;
}

function physicalModel(input, width, height, strength) {
  const output = Buffer.from(input);
  const charge = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) charge[i] = 255 - input[i];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      let force = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if ((dx || dy) && nx >= 0 && nx < width && ny >= 0 && ny < height)
          force += (charge[ny * width + nx] - charge[index]) / (Math.abs(dx) + Math.abs(dy));
      }
      output[index] = quantize(clamp(input[index] - force * strength));
    }
  }
  return output;
}

function dither(input, width, height, method = "floyd-steinberg") {
  switch (method) {
    case "threshold": {
      const output = Buffer.alloc(input.length);
      for (let i = 0; i < input.length; i++) output[i] = quantize(input[i]);
      return output;
    }
    case "random": return randomDither(input);
    case "pattern": return patternDither(input, width, height);
    case "ordered-halftone": return ordered(input, width, height, HALFTONE_4);
    case "ordered-bayer": return ordered(input, width, height, BAYER_4);
    case "ordered-void-cluster": return voidAndCluster(input, width, height);
    case "riemersma": return riemersma(input, width, height);
    case "atkinson": return atkinson(input, width, height);
    case "gradient-based": return gradientBased(input, width, height);
    case "lattice-boltzmann": return physicalModel(input, width, height, 0.08);
    case "electrostatic": return physicalModel(input, width, height, 0.14);
    default: return errorDiffusion(input, width, height, DIFFUSION_KERNELS[method] || DIFFUSION_KERNELS["floyd-steinberg"]);
  }
}

module.exports = { dither };
