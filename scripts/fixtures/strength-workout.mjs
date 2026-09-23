import { weightKg } from "../../dist-electron/strengthWorkoutPatch.js";
export function program(id = '9223372036854775701') {
  return { id, sportType: 4, name: 'Kettlebell A', overview: 'Preserve notes', unknown: { keep: true }, exercises: [
    { id: '10', originId: 'kb-swing', name: 'Kettlebell swing', sportType: 4, exerciseType: 2, targetType: 3, targetValue: 10, targetDisplayUnit: 0, intensityType: 1, intensityCustom: 0, intensityValue: weightKg(26, 'lb'), intensityValueExtend: weightKg(26, 'lb'), intensityDisplayUnit: 7, sets: 3, restType: 1, restValue: 60, sortNo: 100, groupId: '0', isGroup: false, custom: 'retain' },
    { id: '11', originId: 'db-curl', name: 'Dumbbell curl', sportType: 4, exerciseType: 2, targetType: 3, targetValue: 12, intensityType: 1, intensityCustom: 0, intensityValue: weightKg(26, 'lb'), intensityValueExtend: weightKg(26, 'lb'), intensityDisplayUnit: 7, sets: 2, restType: 1, restValue: 30, sortNo: 200, groupId: '0', isGroup: false },
    { id: '12', originId: 'kb-swing', name: 'Warmup swing', sportType: 4, exerciseType: 2, targetType: 3, targetValue: 5, intensityType: 1, intensityCustom: 0, intensityValue: 8, intensityValueExtend: 8, intensityDisplayUnit: 6, sets: 1, restType: 1, restValue: 30, sortNo: 300, groupId: '0', isGroup: false }
  ] };
}
