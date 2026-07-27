import {
  ALL_FORMATS,
  BufferSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
} from 'mediabunny';

/**
 * Converte um vídeo qualquer (MOV, WebM, MP4 grande…) para MP4 H.264/AAC
 * dentro do limite de 16MB da Cloud API oficial do WhatsApp — tudo no
 * navegador, via WebCodecs (mediabunny).
 *
 * O bitrate do vídeo é calculado a partir da duração para o resultado caber
 * no orçamento (~15MB de margem). Vídeos longos demais para caber com
 * qualidade mínima são rejeitados com erro claro. Caso real que motivou isto:
 * .mov de 33,5MB nunca entregue (a Meta só aceita MP4/3GPP até 16MB).
 */

/** Limite oficial da Cloud API para vídeo. */
export const WHATSAPP_VIDEO_MAX_BYTES = 16 * 1024 * 1024;

// Orçamento alvo com margem (container + variação do encoder).
const TARGET_BYTES = 15 * 1024 * 1024;
const AUDIO_BITRATE = 96_000;
// Abaixo disso a imagem vira sopa de blocos — melhor recusar e pedir corte.
const MIN_VIDEO_BITRATE = 250_000;
const MAX_VIDEO_BITRATE = 2_500_000;
// Teto de resolução (720p-ish) — reduz drasticamente os bits necessários.
const MAX_DIMENSION = 1280;

export async function convertVideoForWhatsapp(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<Blob> {
  const input = new Input({
    source: new BufferSource(await file.arrayBuffer()),
    formats: ALL_FORMATS,
  });

  const duration = await input.computeDuration();
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('Não consegui ler a duração do vídeo.');
  }

  const budgetBits = TARGET_BYTES * 8;
  const videoBitrate = Math.floor(budgetBits / duration) - AUDIO_BITRATE;
  if (videoBitrate < MIN_VIDEO_BITRATE) {
    const maxSeconds = Math.floor(budgetBits / (MIN_VIDEO_BITRATE + AUDIO_BITRATE));
    throw new Error(
      `Vídeo longo demais para caber nos 16MB da API oficial (~${Math.floor(maxSeconds / 60)}min é o máximo). Corte o vídeo ou envie por uma instância não oficial.`,
    );
  }

  // Não amplia vídeo pequeno — só reduz quando passa do teto.
  const videoTrack = await input.getPrimaryVideoTrack();
  const scaleDown =
    videoTrack !== null &&
    Math.max(videoTrack.displayWidth, videoTrack.displayHeight) > MAX_DIMENSION;

  const output = new Output({
    format: new Mp4OutputFormat(),
    target: new BufferTarget(),
  });
  const conversion = await Conversion.init({
    input,
    output,
    video: {
      codec: 'avc',
      bitrate: Math.min(videoBitrate, MAX_VIDEO_BITRATE),
      ...(scaleDown
        ? { width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'contain' as const }
        : {}),
    },
    audio: { codec: 'aac', bitrate: AUDIO_BITRATE },
  });
  if (!conversion.isValid) {
    throw new Error(
      'Este navegador não consegue converter este vídeo (codec sem suporte). Exporte como MP4 (H.264) e tente de novo.',
    );
  }
  conversion.onProgress = (progress) => onProgress?.(Math.round(progress * 100));
  await conversion.execute();

  const buffer = output.target.buffer;
  if (!buffer || buffer.byteLength === 0) throw new Error('Conversão gerou um arquivo vazio.');
  if (buffer.byteLength > WHATSAPP_VIDEO_MAX_BYTES) {
    throw new Error(
      'Mesmo convertido o vídeo passou de 16MB. Corte o vídeo ou reduza a qualidade na exportação.',
    );
  }
  return new Blob([buffer], { type: 'video/mp4' });
}
