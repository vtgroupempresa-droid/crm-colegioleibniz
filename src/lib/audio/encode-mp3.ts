import { Mp3Encoder } from '@breezystack/lamejs';

/**
 * Converte a gravação do MediaRecorder em MP3 (client-side, puro JS).
 *
 * Por quê: o WhatsApp Cloud API só aceita AAC dentro de audio/mp4 e Opus
 * dentro de audio/ogg — mas o Chrome grava OPUS mesmo quando rotula o
 * container de "audio/mp4" (caso real 24/07: .m4a com boxes Opus/dOps →
 * status failed, mensagem nunca entregue). MP3 (audio/mpeg) é aceito sempre,
 * então normalizamos qualquer formato de gravação para MP3 64kbps mono antes
 * do upload — voz fica leve (~8KB/s) e toca em qualquer aparelho.
 */
export async function recordingToMp3(blob: Blob): Promise<Blob> {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());

    // Downmix para mono (voz não precisa de estéreo e o arquivo cai pela metade).
    const mono = new Float32Array(decoded.length);
    mono.set(decoded.getChannelData(0));
    if (decoded.numberOfChannels > 1) {
      const right = decoded.getChannelData(1);
      for (let i = 0; i < decoded.length; i += 1) {
        mono[i] = ((mono[i] ?? 0) + (right[i] ?? 0)) / 2;
      }
    }

    // Float32 [-1,1] → Int16 PCM (formato de entrada do encoder).
    const samples = new Int16Array(decoded.length);
    for (let i = 0; i < decoded.length; i += 1) {
      const s = Math.max(-1, Math.min(1, mono[i] ?? 0));
      samples[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }

    const encoder = new Mp3Encoder(1, decoded.sampleRate, 64);
    const chunks: Uint8Array[] = [];
    const BLOCK = 1152; // tamanho de frame do MP3
    for (let i = 0; i < samples.length; i += BLOCK) {
      const out = encoder.encodeBuffer(samples.subarray(i, i + BLOCK));
      if (out.length > 0) chunks.push(out);
    }
    const tail = encoder.flush();
    if (tail.length > 0) chunks.push(tail);

    return new Blob(chunks as BlobPart[], { type: 'audio/mpeg' });
  } finally {
    void ctx.close();
  }
}
