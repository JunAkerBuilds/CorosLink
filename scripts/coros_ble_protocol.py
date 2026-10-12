"""Credential-free protocol-v2 framing shared by system Bluetooth workers."""

class ProtocolError(Exception):
    pass


def frames(opcode, payload, maximum):
    if not 0 <= opcode <= 255 or not 3 <= maximum <= 255 or len(payload) > 4096:
        raise ProtocolError('Invalid COROS control request.')
    logical = payload + bytes([sum(payload) & 255])
    size = maximum - 2
    count = (len(logical) + size - 1) // size
    if count > 256:
        raise ProtocolError('COROS control request is too large.')
    return [bytes([opcode, count - i - 1]) + logical[o:o + size]
            for i, o in enumerate(range(0, len(logical), size))]


class Decoder:
    def __init__(self, opcode):
        self.opcode = opcode
        self.remaining = None
        self.data = bytearray()

    def accept(self, value):
        if not value or value[0] != self.opcode:
            return None
        if len(value) < 3 or (self.remaining is not None and value[1] != self.remaining - 1):
            raise ProtocolError('Invalid COROS response frame sequence.')
        self.remaining = value[1]
        self.data.extend(value[2:])
        if len(self.data) > 4096:
            raise ProtocolError('COROS response is too large.')
        if self.remaining:
            return None
        if sum(self.data[:-1]) & 255 != self.data[-1]:
            raise ProtocolError('COROS response checksum failed.')
        return bytes(self.data[:-1])
