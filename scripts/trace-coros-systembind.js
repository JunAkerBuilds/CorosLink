/*
 * Read-only Frida helper for a user-owned COROS Android session.
 *
 * It intentionally logs only SystemBind command metadata and the Java call
 * stack—never a payload, pairing key, or account token. Run with:
 *   frida -U -n COROS -l scripts/trace-coros-systembind.js
 * Then reconnect the watch in the COROS app.
 */

Java.perform(() => {
  const BluetoothGatt = Java.use("android.bluetooth.BluetoothGatt");
  const GattCallbackV2 = Java.use("com.yf.lib.bluetooth.protocol.version2.GattCallbackV2");
  const Exception = Java.use("java.lang.Exception");
  const Log = Java.use("android.util.Log");

  for (const overload of BluetoothGatt.writeCharacteristic.overloads) {
    const signature = overload.argumentTypes.map((type) => type.className).join(", ");
    overload.implementation = function () {
      const args = Array.prototype.slice.call(arguments);
      const characteristic = args[0];
      const value = args.length >= 2 && signature.includes("[B")
        ? args[1]
        : characteristic.getValue();
      const firstByte = value && value.length ? value[0] & 0xff : -1;

      if (firstByte === 0xa5) {
        console.log(
          "SystemBind write: length=" + value.length +
            " characteristic=" + characteristic.getUuid() +
            " overload=(" + signature + ")"
        );
        console.log(Log.getStackTraceString(Exception.$new()));
      }

      return overload.call.apply(overload, [this].concat(args));
    };
  }

  // This higher-level hook distinguishes the transaction that constructed an
  // A5 message from its GATT fragments. It intentionally reports only class
  // name and byte length; payloads can contain account/session material.
  const sendV2 = GattCallbackV2.f.overload(
    "com.yf.lib.bluetooth.protocol.version2.transaction.Transaction",
    "int",
    "[B",
    "long",
    "com.yf.lib.bluetooth.protocol.CharacterType"
  );
  sendV2.implementation = function (transaction, opcode, payload, timeoutMs, characterType) {
    if ((opcode & 0xff) === 0xa5) {
      console.log(
        "SystemBind transaction: class=" + transaction.$className +
          " payloadBytes=" + (payload ? payload.length : 0) +
          " channel=" + characterType
      );
      console.log(Log.getStackTraceString(Exception.$new()));
    }
    return sendV2.call(this, transaction, opcode, payload, timeoutMs, characterType);
  };

  console.log("SystemBind stack tracer attached; waiting for a watch reconnect.");
});
