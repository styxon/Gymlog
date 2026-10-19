import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { PROGRAM_IMAGE_MAX_BASE64_CHARS, ProgramImageMediaType } from '../lib/programImageImport';

/**
 * Choosing a photo of a programme and getting it small enough to send.
 *
 * Kept out of `src/lib` because every line of it touches the device: the
 * system picker and the image encoder.
 */

export interface PickedProgramImage {
  dataBase64: string;
  mediaType: ProgramImageMediaType;
}

export type PickProgramImageResult =
  | { status: 'picked'; image: PickedProgramImage }
  | { status: 'cancelled' }
  | { status: 'too_large' }
  | { status: 'failed' };

/**
 * What a whole photo import came to, as the sheet needs to hear it.
 *
 * `cancelled` is its own answer because the sheet used to be handed `null` for
 * every ending and said "Could not read a programme from that photo" — to a
 * reader who had backed out of the picker, about a photo that was never sent
 * (audit 3, 2026-09-19). Declining the online notice ends the same way: the
 * reader said no, which is not a failure to report back to them.
 */
export type ProgramImageImportResult =
  | { status: 'read'; csv: string }
  | { status: 'cancelled' }
  | { status: 'spent' }
  | { status: 'failed' };

/**
 * Longest edge, in pixels, after downscaling.
 *
 * A 4000px phone photo of a spreadsheet is not more readable than a 1600px
 * one — the text is the same size relative to the frame — but it is several
 * times the bytes and several times the tokens. 1600 keeps small print legible
 * while landing comfortably under the endpoint's size cap.
 */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.7;

async function encode(uri: string, width: number | undefined): Promise<string | null> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    width ? [{ resize: { width } }] : [],
    { compress: JPEG_QUALITY, format: ImageManipulator.SaveFormat.JPEG, base64: true },
  );
  return result.base64 ?? null;
}

/**
 * Opens the library, downscales what comes back, and returns base64 JPEG.
 *
 * Always re-encodes to JPEG rather than passing the original through: it makes
 * the media type a fact rather than a guess from a file extension, and it is
 * what brings a 6 MB photo under the cap.
 */
export async function pickProgramImage(): Promise<PickProgramImageResult> {
  try {
    // No permission request.
    //
    // Android 13+ opens the system photo picker, which hands back only the
    // file the reader chose and needs no permission at all — the generated
    // manifest carries READ_EXTERNAL_STORAGE capped at SDK 32 for exactly
    // that reason. Asking anyway can only produce a dialog the reader does
    // not need and a false refusal when the OS declines to show one.
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      // No cropping step: the reader is importing a table, and a crop UI
      // between them and the result is one more thing to get wrong.
      allowsEditing: false,
    });
    if (picked.canceled || !picked.assets?.length) {
      return { status: 'cancelled' };
    }

    const asset = picked.assets[0];
    const width = asset.width && asset.width > MAX_EDGE ? MAX_EDGE : undefined;
    let base64 = await encode(asset.uri, width);
    if (!base64) {
      return { status: 'failed' };
    }

    // One more pass for the outliers — a very wide sheet can still be big at
    // 1600px. Halving the edge quarters the pixels, which is enough.
    if (base64.length > PROGRAM_IMAGE_MAX_BASE64_CHARS) {
      base64 = await encode(asset.uri, Math.round(MAX_EDGE / 2));
      if (!base64) {
        return { status: 'failed' };
      }
    }
    if (base64.length > PROGRAM_IMAGE_MAX_BASE64_CHARS) {
      return { status: 'too_large' };
    }

    return { status: 'picked', image: { dataBase64: base64, mediaType: 'image/jpeg' } };
  } catch {
    return { status: 'failed' };
  }
}
