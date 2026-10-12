import asyncio,binascii,unittest
from coros_ble_route import send_route_block,validate_block
from coros_ble_protocol import ProtocolError

def header(block, offset=0):
    h=bytearray(21);h[0]=0x78;h[2]=0x14;h[3:7]=offset.to_bytes(4,'little')
    h[7:9]=len(block).to_bytes(2,'little');h[9:13]=len(block).to_bytes(4,'little')
    h[13:15]=binascii.crc_hqx(block,0xffff).to_bytes(2,'little');h[15]=sum(block)&255;h[19]=3;h[20]=sum(h[2:20])&255
    return bytes(h)

def ack(body):
    return b'\x78\x00'+body+bytes([sum(body)&255])

class TransferTests(unittest.IsolatedAsyncioTestCase):
    async def test_negotiated_packets_and_final_ack(self):
        for size in [20,240]:
            block=bytes(range(256))*16;queue=asyncio.Queue();written=[]
            async def control(value):
                validate_block(value,block);queue.put_nowait(ack(bytes([0,0,size,26,1,3])))
            async def bulk(value):
                self.assertLessEqual(len(value),size);written.append(value)
                if sum(len(v)-3 for v in written)==len(block):queue.put_nowait(ack(b'\x01\x00\x14'))
            await send_route_block(header(block),block,queue,control,bulk,244)
            self.assertEqual(b''.join(v[3:]for v in written),block)
            self.assertEqual([v[1]for v in written],list(range(len(written))))
    async def test_rejection_does_not_send_bulk(self):
        block=b'route';queue=asyncio.Queue();written=[]
        async def control(value):queue.put_nowait(ack(b'\x00\x01\xf0\x1a\x00\x03'))
        async def bulk(value):written.append(value)
        with self.assertRaises(ProtocolError):await send_route_block(header(block),block,queue,control,bulk,244)
        self.assertEqual(written,[])
    async def test_cached_block_and_extended_completion(self):
        block=b'route';queue=asyncio.Queue();written=[]
        async def cached(value):queue.put_nowait(ack(b'\x01\x00\xf0\x1a\x01\x03'))
        async def bulk(value):
            written.append(value);queue.put_nowait(ack(b'\x01\x01\xf0\x1a\x01\x03'))
        await send_route_block(header(block),block,queue,cached,bulk,244)
        self.assertEqual(written,[])
        async def ready(value):queue.put_nowait(ack(b'\x00\x00\xf0\x1a\x01\x03'))
        await send_route_block(header(block),block,queue,ready,bulk,244)
        self.assertEqual(len(written),1)
    async def test_disconnect_and_small_mtu(self):
        block=b'route';queue=asyncio.Queue()
        async def control(value):queue.put_nowait(None)
        async def bulk(value):self.fail('Unexpected bulk write')
        with self.assertRaisesRegex(ProtocolError,'disconnected'):await send_route_block(header(block),block,queue,control,bulk,244)
        with self.assertRaisesRegex(ProtocolError,'packet size'):await send_route_block(header(block),block,queue,control,bulk,20)
    def test_corruption(self):
        block=b'route';bad=bytearray(header(block));bad[13]^=1
        with self.assertRaises(ProtocolError):validate_block(bytes(bad),block)
        with self.assertRaises(ProtocolError):validate_block(header(block),b'wrong')

if __name__=='__main__':unittest.main()
