import {
  ALL_FORMATS,
  BufferSource,
  BufferTarget,
  Conversion,
  Input,
  OggOutputFormat,
  Output,
} from 'mediabunny';

/**
 * Reempacota a gravação do MediaRecorder (Opus em WebM/MP4) num container
 * OGG — SEM re-codificar o áudio.
 *
 * Por quê: o WhatsApp só renderiza "mensagem de voz" nativa (PTT, com
 * waveform e ícone de microfone) quando o áudio é OGG/Opus; MP3 e M4A chegam
 * como arquivo de áudio genérico. O Chrome já grava Opus — só está no
 * container errado. Falhou (ex.: navegador sem Opus)? O caller cai no
 * fallback MP3 (chega como arquivo, mas chega).
 */
export async function recordingToOggOpus(blob: Blob): Promise<Blob> {
  const input = new Input({
    source: new BufferSource(await blob.arrayBuffer()),
    formats: ALL_FORMATS,
  });
  const output = new Output({
    format: new OggOutputFormat(),
    target: new BufferTarget(),
  });
  const conversion = await Conversion.init({ input, output });
  if (!conversion.isValid) throw new Error('Conversão para OGG indisponível para esta gravação');
  await conversion.execute();
  const buffer = output.target.buffer;
  if (!buffer || buffer.byteLength === 0) throw new Error('OGG vazio após conversão');
  return new Blob([buffer], { type: 'audio/ogg' });
}
