// The rules for installing a compiled face on a watch's face slots, from CorosLink's Bluetooth install path
// (corosNativeBleService.ts listWatchfaceSlots / syncWatchface), as pure functions with no transport: this app has
// no Bluetooth yet. A transport reads the face list (command 0x96), sends the plan's blocks as file 8, then reads
// the list again until the slot holds the face.
import {
  decodeWatchfaceInventory, encodeWatchfaceBlockHeader, encodeWatchfaceFile, selectWatchfaceSlot, WATCHFACE_BLOCK_BYTES, WATCHFACE_FILE_INDEX,
} from "./corosBleWatchfaceProtocol";
import { getWatchfaceTarget, watchfaceBinTarget, watchfaceTargetsForMagic } from "./watchfaceTargets";

/** The control command that reads the face list, and its one argument byte. */
export const FACE_LIST_COMMAND = 0x96;
export const FACE_LIST_ARGUMENT = Buffer.from([0]);
/** A slot's ID when it's empty. */
export const EMPTY_FACE_ID = 0xffffffff;
/** After the last block, the face list is read this many times, this far apart, until the slot holds the new face. */
export const VERIFY_ATTEMPTS = 8;
export const VERIFY_INTERVAL_MS = 500;

export interface WatchSlot { slot: number; faceId: number | null }

/**
 * A face-list answer as slots. Ten slots padded from five or ten IDs only on PACE Pro, as CorosLink has always read
 * it; other watches get only the slots they report, so a face never goes to a slot they may not have.
 */
export function parseFaceList(payload: Buffer, model?: string): WatchSlot[] {
  return decodeWatchfaceInventory(payload, model === "pace-pro").map((id, slot) => ({ slot, faceId: id === EMPTY_FACE_ID ? null : id }));
}

const ids = (slots: readonly WatchSlot[]) => slots.map((s) => s.faceId ?? EMPTY_FACE_ID);

/** Where the user chose to install: a slot from an earlier read, and whether replacing its face is meant. */
export interface SlotChoice { slot: number; replaceExisting: boolean }
/** A choice with the face the slot held when it was read, which must still be there. */
export interface SlotTarget extends SlotChoice { expectedFaceId: number | null }

/** Pairs a choice with what the earlier read saw in that slot. */
export function slotTarget(earlier: readonly WatchSlot[], choice: SlotChoice): SlotTarget {
  if (!Number.isInteger(choice.slot) || choice.slot < 0 || choice.slot > 9 || typeof choice.replaceExisting !== "boolean" || choice.slot >= earlier.length) {
    throw new Error("Refresh watch face slots and choose the destination again.");
  }
  return { ...choice, expectedFaceId: earlier[choice.slot].faceId };
}

/**
 * The slot to install into, from the list read just before sending. No target: the first empty slot. A target: the
 * slot must still hold the face it held when chosen, and an occupied one is used only when replacing was chosen.
 */
export function chooseSlot(current: readonly WatchSlot[], target?: SlotTarget): number {
  return selectWatchfaceSlot(ids(current), target);
}

/** The last check before anything is sent: the BIN must be built for this watch's screen. */
export function checkFaceFits(magic: string, model: string): void {
  const watch = getWatchfaceTarget(model);
  if (!watch) throw new Error("This watch can't take watch faces from C-LINK yet.");
  if (watchfaceBinTarget(watch).magic === magic) return;
  const built = watchfaceTargetsForMagic(magic)[0];
  throw new Error(`This face was built for ${built ? `a ${watchfaceBinTarget(built).screen} px ${built.label}` : "another watch"}, not your ${watch.label}. Compile it for this watch.`);
}

export interface InstallBlock { offset: number; header: Buffer; block: Buffer }
export interface InstallPlan {
  faceId: number;
  magic: string;
  slot: number;
  fileIndex: number;
  /** The HF file: a 16-byte header and the BIN. */
  totalBytes: number;
  /** In order, 4 KB each (the last may be shorter). */
  blocks: InstallBlock[];
  verify: { attempts: number; intervalMs: number };
}

/** A compiled BIN as the blocks that install it into `slot`. */
export function installPlan(bin: Buffer, slot: number): InstallPlan {
  const { file, faceId, magic } = encodeWatchfaceFile(bin);
  const blocks: InstallBlock[] = [];
  for (let offset = 0; offset < file.length; offset += WATCHFACE_BLOCK_BYTES) {
    const block = file.subarray(offset, offset + WATCHFACE_BLOCK_BYTES);
    blocks.push({ offset, header: encodeWatchfaceBlockHeader(block, offset, file.length, slot), block });
  }
  return { faceId, magic, slot, fileIndex: WATCHFACE_FILE_INDEX, totalBytes: file.length, blocks, verify: { attempts: VERIFY_ATTEMPTS, intervalMs: VERIFY_INTERVAL_MS } };
}

/** Whether a face list read after sending shows the new face in its slot. */
export const installed = (after: readonly WatchSlot[], plan: Pick<InstallPlan, "slot" | "faceId">) => after[plan.slot]?.faceId === plan.faceId;

/**
 * How an install was confirmed: the slot already held this face (a reinstall), so only the transfer's acknowledgement
 * says it arrived; otherwise the face's ID appeared in the slot.
 */
export function verification(target: SlotTarget | undefined, plan: Pick<InstallPlan, "faceId">): "transfer-acknowledged" | "inventory-id" {
  return target && target.expectedFaceId === plan.faceId ? "transfer-acknowledged" : "inventory-id";
}
