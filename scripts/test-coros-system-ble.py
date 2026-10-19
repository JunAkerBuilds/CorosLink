import asyncio,enum,importlib.util,io,os,sys,types,unittest
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

class BleakError(Exception):pass
class BleakGATTProtocolError(BleakError):
    def __init__(self,code):super().__init__(code,'GATT Protocol Error')
class BleakBluetoothNotAvailableError(BleakError):
    def __init__(self,msg,reason):super().__init__(msg);self.reason=reason
BleakGATTProtocolErrorCode=enum.IntEnum('BleakGATTProtocolErrorCode',{'INSUFFICIENT_AUTHENTICATION':5,'INSUFFICIENT_ENCRYPTION':15})

class FakeClient:
    # refuse_unpaired: notifications after the first need pairing. pair_error: pair() fails with it.
    refuse_unpaired=False;pair_error=None
    def __init__(self,device,**kwargs):
        self.paired_at_connect=self.paired=kwargs['pair'];self.pair_calls=0;self.subscriptions=0
        self.callback=kwargs['disconnected_callback'];self.is_connected=False;self.writes=[];self.notify=None
        self.char=SimpleNamespace(properties=['read','write-without-response','notify'],max_write_without_response_size=244)
        self.services=SimpleNamespace(get_characteristic=lambda uuid:self.char)
    async def connect(self):self.is_connected=True
    async def disconnect(self):self.is_connected=False;self.callback(self)
    async def read_gatt_char(self,char):return b'\x43'
    async def pair(self):
        self.pair_calls+=1
        if FakeClient.pair_error:raise BleakError(FakeClient.pair_error)
        self.paired=True
    async def start_notify(self,char,callback):
        if FakeClient.refuse_unpaired and not self.paired and self.subscriptions:raise BleakGATTProtocolError(0x0f)
        self.subscriptions+=1
        if self.notify is None:self.notify=callback
    async def write_gatt_char(self,char,value,response):
        assert response is False
        self.writes.append(value)
        if value[1]==0:
            for reply in frames(0xa5,b'watch reply',20):self.notify(self.char,reply)

sys.modules['bleak']=SimpleNamespace(BleakClient=FakeClient,BleakScanner=FakeScanner)
sys.modules['bleak.exc']=SimpleNamespace(BleakError=BleakError,BleakGATTProtocolError=BleakGATTProtocolError,
    BleakBluetoothNotAvailableError=BleakBluetoothNotAvailableError,BleakGATTProtocolErrorCode=BleakGATTProtocolErrorCode)
spec=importlib.util.spec_from_file_location('system_ble',Path(__file__).with_name('coros-system-ble.py'))
worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)
Session=worker.SystemSession

def windows_session():
    original=sys.platform;sys.platform='win32'
    try:return Session()
    finally:sys.platform=original

class SystemTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.addCleanup(setattr,FakeClient,'refuse_unpaired',False);self.addCleanup(setattr,FakeClient,'pair_error',None)
    async def test_native_pairing_exact_device_exchange_and_disconnect(self):
        for platform in ['win32','linux']:
            original=sys.platform;sys.platform=platform
            try:session=worker.SystemSession()
            finally:sys.platform=original
            state=await session.connect('COROS PACE Pro TEST')
            # BlueZ pairs while connecting; Windows stays unpaired unless the watch asks.
            self.assertEqual((session.client.paired_at_connect,session.client.pair_calls),(platform!='win32',0))
            self.assertEqual(state['deviceId'],'COROS PACE Pro TEST')
            self.assertEqual(state['transport'],'winrt' if platform=='win32' else 'bluez')
            self.assertEqual(len(state['channels']),3)
            payload=bytes(range(256))+bytes(37)
            self.assertEqual(await session.exchange(payload,240),b'watch reply')
            self.assertEqual([len(value) for value in session.client.writes],[240,58])
            self.assertNotIn('rssiDbm',await session.status())
            await session.close();self.assertFalse(session.state['connected'])
            self.assertEqual(session.state['systemBind'],'not_authenticated')
    async def test_windows_pairs_only_when_the_watch_refuses(self):
        FakeClient.refuse_unpaired=True
        session=windows_session();state=await session.connect('COROS PACE Pro TEST')
        # Channels subscribed before pairing are not subscribed twice.
        self.assertEqual((session.client.pair_calls,session.client.subscriptions,session.step),(1,3,None))
        self.assertEqual([channel['subscribed'] for channel in state['channels']],[True,True,True])
        self.assertTrue(state['connected'])
        FakeClient.pair_error='Could not pair with device: REJECTED_BY_OTHER_END'
        session=windows_session()
        with self.assertRaises(BleakError) as caught:await session.connect('COROS PACE Pro TEST')
        self.assertEqual((session.step,worker.failure_reason(caught.exception)),('pair','rejected by other end'))
    async def test_connect_failure_names_the_step(self):
        FakeClient.refuse_unpaired=True;FakeClient.pair_error='Could not pair with device: REJECTED_BY_OTHER_END'
        emitted=[];emit=worker.emit;stdin=sys.stdin;umask=os.umask(0o022);os.umask(umask)
        worker.emit=emitted.append;worker.SystemSession=windows_session
        sys.stdin=io.TextIOWrapper(io.BytesIO(b'{"id":1,"operation":"connect","deviceName":"COROS PACE Pro TEST"}\n'))
        try:await worker.main()
        finally:
            sys.stdin=stdin;os.umask(umask);worker.SystemSession=Session;worker.emit=emit
            import logging;logging.disable(logging.NOTSET)
        reply=emitted[-1]
        self.assertTrue(reply['error'].startswith('System Bluetooth failed while pairing with the watch (rejected by other end). Confirm any Windows pairing prompt.'),reply['error'])
        self.assertEqual({key:reply['detail'][key] for key in ['operation','exception','step','reason']},
                         {'operation':'connect','exception':'BleakError','step':'pair','reason':'rejected by other end'})
    def test_failure_labels_leave_out_device_details(self):
        reason=worker.failure_reason
        self.assertEqual(reason(BleakError('Could not get GATT services: Unreachable')),'unreachable')
        self.assertEqual(reason(BleakError('Could not start notify on 000E: Access Denied')),'access denied')
        self.assertEqual(reason(BleakGATTProtocolError(0x0f)),'GATT insufficient encryption')
        self.assertEqual(reason(BleakGATTProtocolError(0x99)),'GATT error 0x99')
        self.assertEqual(reason(asyncio.TimeoutError()),'timed out')
        self.assertEqual(reason(BleakError('Device with address AA:BB:CC:DD:EE:FF was not found.')),'BleakError')
        self.assertTrue(worker.pairing_required(BleakGATTProtocolError(0x05)))
        self.assertTrue(worker.pairing_required(BleakError('Could not start notify on 000E: Access Denied')))
        self.assertFalse(worker.pairing_required(BleakError('Could not get GATT services: Unreachable')))
        self.assertIn('Bluetooth & devices',worker.failure_message('connect','unreachable',True))
        self.assertIn('BlueZ',worker.failure_message('connect','timed out',False))
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
