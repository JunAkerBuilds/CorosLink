import asyncio,importlib.util,sys,types,unittest
from pathlib import Path
from types import SimpleNamespace
from coros_ble_protocol import frames,Decoder,ProtocolError

class FakeScanner:
    def __init__(self,callback):self.callback=callback
    async def __aenter__(self):
        for name in ['Unrelated device','COROS PACE Pro OTHER','COROS PACE Pro TEST']:
            self.callback(SimpleNamespace(address=name,name=name),SimpleNamespace(local_name=name,rssi=-50))
        return self
    async def __aexit__(self,*args):pass

class FakeClient:
    def __init__(self,device,**kwargs):
        assert kwargs['pair'] is True
        self.callback=kwargs['disconnected_callback'];self.is_connected=False;self.writes=[];self.notify=None
        self.char=SimpleNamespace(properties=['read','write-without-response','notify'],max_write_without_response_size=244)
        self.services=SimpleNamespace(get_characteristic=lambda uuid:self.char)
    async def connect(self):self.is_connected=True
    async def disconnect(self):self.is_connected=False;self.callback(self)
    async def read_gatt_char(self,char):return b'\x43'
    async def start_notify(self,char,callback):
        if self.notify is None:self.notify=callback
    async def write_gatt_char(self,char,value,response):
        assert response is False
        self.writes.append(value)
        if value[1]==0:
            for reply in frames(0xa5,b'watch reply',20):self.notify(self.char,reply)

sys.modules['bleak']=SimpleNamespace(BleakClient=FakeClient,BleakScanner=FakeScanner)
spec=importlib.util.spec_from_file_location('system_ble',Path(__file__).with_name('coros-system-ble.py'))
worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)

class SystemTests(unittest.IsolatedAsyncioTestCase):
    async def test_native_pairing_exact_device_exchange_and_disconnect(self):
        for platform in ['win32','linux']:
            original=sys.platform;sys.platform=platform
            try:session=worker.SystemSession()
            finally:sys.platform=original
            state=await session.connect('COROS PACE Pro TEST')
            self.assertEqual(state['deviceId'],'COROS PACE Pro TEST')
            self.assertEqual(state['transport'],'winrt' if platform=='win32' else 'bluez')
            self.assertEqual(len(state['channels']),3)
            payload=bytes(range(256))+bytes(37)
            self.assertEqual(await session.exchange(payload,240),b'watch reply')
            self.assertEqual([len(value) for value in session.client.writes],[240,58])
            self.assertNotIn('rssiDbm',await session.status())
            await session.close();self.assertFalse(session.state['connected'])
            self.assertEqual(session.state['systemBind'],'not_authenticated')
    async def test_remembered_identity_only(self):
        # Two devices share the watch's name: with a remembered address only that one is used,
        # and another one alone is reported back, never connected to.
        made=[]
        class Recording(FakeClient):
            def __init__(self,device,**kwargs):made.append(device.address);super().__init__(device,**kwargs)
        def scanner(addresses):
            class Scanner(FakeScanner):
                async def __aenter__(self):
                    for address in addresses:
                        self.callback(SimpleNamespace(address=address,name='COROS PACE 4 TEST'),SimpleNamespace(local_name='COROS PACE 4 TEST',rssi=-50))
                    return self
            return Scanner
        original=(worker.BleakScanner,worker.BleakClient,worker.PINNED_GRACE_SECONDS)
        worker.BleakClient=Recording;worker.PINNED_GRACE_SECONDS=0.05
        try:
            worker.BleakScanner=scanner(['AA:AA:AA:AA:AA:01','AA:AA:AA:AA:AA:02'])
            state=await worker.SystemSession().connect('COROS PACE 4 TEST','aa:aa:aa:aa:aa:02')
            self.assertEqual(state['deviceId'],'AA:AA:AA:AA:AA:02');self.assertEqual(made,['AA:AA:AA:AA:AA:02'])
            worker.BleakScanner=scanner(['AA:AA:AA:AA:AA:01'])
            with self.assertRaises(worker.IdentityMismatch) as caught:
                await worker.SystemSession().connect('COROS PACE 4 TEST','AA:AA:AA:AA:AA:02')
            self.assertEqual(caught.exception.address,'AA:AA:AA:AA:AA:01');self.assertEqual(made,['AA:AA:AA:AA:AA:02'],'nothing connected')
            with self.assertRaises(ProtocolError):await worker.SystemSession().connect('COROS PACE 4 TEST',7)
        finally:worker.BleakScanner,worker.BleakClient,worker.PINNED_GRACE_SECONDS=original
    def test_reply_validation_and_frame_sizes(self):
        for size in [20,182,240]:
            payload=bytes(range(255));decoder=Decoder(0xa5);result=None
            for value in frames(0xa5,payload,size):
                self.assertLessEqual(len(value),size);result=decoder.accept(value)
            self.assertEqual(result,payload)
        values=frames(0xa5,b'abc',20);bad=bytearray(values[0]);bad[-1]^=1
        with self.assertRaises(ProtocolError):Decoder(0xa5).accept(bad)
        decoder=Decoder(0xa5);values=frames(0xa5,bytes(60),20);decoder.accept(values[0])
        with self.assertRaises(ProtocolError):decoder.accept(values[-1])

if __name__=='__main__':unittest.main()
