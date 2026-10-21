import asyncio,enum,importlib.util,io,json,logging,os,sys,types,unittest
from pathlib import Path
from types import SimpleNamespace
from coros_ble_protocol import frames,Decoder,ProtocolError

class FakeScanner:
    def __init__(self,callback):self.callback=callback
    async def __aenter__(self):
        for index,name in enumerate(['Unrelated device','COROS PACE Pro OTHER','COROS PACE Pro TEST']):
            self.callback(SimpleNamespace(address=f'C0:00:00:00:00:{index:02X}',name=name),SimpleNamespace(local_name=name,rssi=-50))
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
    # bonded: Windows lists the watch as paired. stale: with a bond, the step ('connect' or 'subscribe')
    # that fails until unpair() removes it; unpair_error: unpair() fails with it. unpairs: whether each
    # unpair() came while its client was still connected. clients: every client made.
    refuse_unpaired=False;pair_error=None;bonded=False;stale=None;unpair_error=None;unpairs=[];clients=[]
    def __init__(self,device,**kwargs):
        FakeClient.clients.append(self)
        self.paired_at_connect=self.paired=kwargs['pair'];self.pair_calls=0;self.subscriptions=0
        self.callback=kwargs['disconnected_callback'];self.is_connected=False;self.writes=[];self.notify=None
        self.char=SimpleNamespace(properties=['read','write-without-response','notify'],max_write_without_response_size=244)
        self.services=SimpleNamespace(get_characteristic=lambda uuid:self.char)
    async def connect(self):
        if FakeClient.bonded and FakeClient.stale=='connect':raise BleakError('Could not get GATT services: Unreachable')
        self.is_connected=True
    async def disconnect(self):self.is_connected=False;self.callback(self)
    async def read_gatt_char(self,char):return b'\x43'
    async def pair(self):
        self.pair_calls+=1
        if FakeClient.pair_error:raise BleakError(FakeClient.pair_error)
        self.paired=True
    async def unpair(self):
        FakeClient.unpairs.append(self.is_connected)
        if FakeClient.unpair_error:raise BleakError(FakeClient.unpair_error)
        FakeClient.bonded=False
    async def start_notify(self,char,callback):
        if FakeClient.bonded and FakeClient.stale=='subscribe':raise BleakError('Could not start notify on 000E: Access Denied')
        if FakeClient.refuse_unpaired and not self.paired and self.subscriptions:raise BleakGATTProtocolError(0x0f)
        self.subscriptions+=1
        if self.notify is None:self.notify=callback
    async def write_gatt_char(self,char,value,response):
        assert response is False
        self.writes.append(value)
        if value[1]==0:
            for reply in frames(0xa5,b'watch reply',20):self.notify(self.char,reply)

class FakeLEDevice:
    # missing: no device at the address. lookups: addresses asked for. open: requesters not closed.
    missing=False;lookups=[];open=0
    @staticmethod
    async def from_bluetooth_address_async(address):
        FakeLEDevice.lookups.append(address)
        if FakeLEDevice.missing:return None
        FakeLEDevice.open+=1
        return SimpleNamespace(device_information=SimpleNamespace(id=f'BluetoothLE#{address:012x}'),close=FakeLEDevice.close)
    @staticmethod
    def close():FakeLEDevice.open-=1
class FakeDeviceInformation:
    @staticmethod
    async def create_from_id_async(device_id):return SimpleNamespace(pairing=SimpleNamespace(is_paired=FakeClient.bonded))

sys.modules['bleak']=SimpleNamespace(BleakClient=FakeClient,BleakScanner=FakeScanner)
sys.modules['winrt.windows.devices.bluetooth']=SimpleNamespace(BluetoothLEDevice=FakeLEDevice)
sys.modules['winrt.windows.devices.enumeration']=SimpleNamespace(DeviceInformation=FakeDeviceInformation)
sys.modules['bleak.exc']=SimpleNamespace(BleakError=BleakError,BleakGATTProtocolError=BleakGATTProtocolError,
    BleakBluetoothNotAvailableError=BleakBluetoothNotAvailableError,BleakGATTProtocolErrorCode=BleakGATTProtocolErrorCode)
spec=importlib.util.spec_from_file_location('system_ble',Path(__file__).with_name('coros-system-ble.py'))
worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)
Session=worker.SystemSession

def windows_session():
    original=sys.platform;sys.platform='win32'
    try:return Session()
    finally:sys.platform=original

async def run_main(*requests):
    """Lines main() emits for these requests on a Windows session, serialized at once
    like emit(): a reply's result is the live session state."""
    emitted=[];emit=worker.emit;stdin=sys.stdin;umask=os.umask(0o022);os.umask(umask)
    worker.emit=lambda value:emitted.append(json.loads(json.dumps(value)));worker.SystemSession=windows_session
    sys.stdin=io.TextIOWrapper(io.BytesIO(b''.join(json.dumps(request).encode()+b'\n' for request in requests)))
    try:await worker.main()
    finally:
        sys.stdin=stdin;os.umask(umask);worker.SystemSession=Session;worker.emit=emit
        logging.disable(logging.NOTSET)
    return emitted

CONNECT={'id':1,'operation':'connect','deviceName':'COROS PACE Pro TEST'}

class SystemTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        for name,value in [('refuse_unpaired',False),('pair_error',None),('bonded',False),('stale',None),('unpair_error',None)]:
            self.addCleanup(setattr,FakeClient,name,value)
        FakeClient.unpairs=[];FakeClient.clients=[];FakeLEDevice.lookups=[];FakeLEDevice.missing=False;FakeLEDevice.open=0
    async def test_native_pairing_exact_device_exchange_and_disconnect(self):
        for platform in ['win32','linux']:
            original=sys.platform;sys.platform=platform
            try:session=worker.SystemSession()
            finally:sys.platform=original
            state=await session.connect('COROS PACE Pro TEST')
            # BlueZ pairs while connecting; Windows stays unpaired unless the watch asks.
            self.assertEqual((session.client.paired_at_connect,session.client.pair_calls),(platform!='win32',0))
            self.assertEqual(state['deviceId'],'C0:00:00:00:00:02')
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
        reply=(await run_main(CONNECT))[-1]
        self.assertTrue(reply['error'].startswith('System Bluetooth failed while pairing with the watch (rejected by other end). Confirm any Windows pairing prompt.'),reply['error'])
        self.assertEqual({key:reply['detail'][key] for key in ['operation','exception','step','reason']},
                         {'operation':'connect','exception':'BleakError','step':'pair','reason':'rejected by other end'})
    async def test_windows_clears_a_stale_bond_and_retries_once(self):
        # A bond from 0.1.57/0.1.58 the watch has dropped: connecting or subscribing fails until it is gone.
        for stale in ['connect','subscribe']:
            FakeClient.bonded=True;FakeClient.stale=stale;FakeClient.unpairs=[];FakeClient.clients=[];FakeLEDevice.lookups=[]
            session=windows_session();state=await session.connect('COROS PACE Pro TEST')
            # One unpair, after the failed client closed, then one fresh unpaired client.
            self.assertEqual((FakeClient.unpairs,FakeClient.bonded,len(FakeClient.clients)),([False],False,2))
            self.assertEqual((FakeLEDevice.lookups,FakeLEDevice.open),([0xC00000000002],0))
            self.assertEqual((session.stale_bond_cleared,session.step,session.client),(True,None,FakeClient.clients[1]))
            self.assertEqual((session.client.paired_at_connect,session.client.pair_calls,session.client.subscriptions),(False,0,3))
            self.assertEqual((state['phase'],state['connected'],state['systemBind']),('connected',True,'unavailable'))
            self.assertEqual([channel['subscribed'] for channel in state['channels']],[True,True,True])
    async def test_working_or_unknown_bonds_are_left_alone(self):
        for bonded in [False,True]:
            FakeClient.bonded=bonded;session=windows_session();state=await session.connect('COROS PACE Pro TEST')
            self.assertTrue(state['connected'])
            self.assertEqual((FakeClient.unpairs,FakeClient.bonded,FakeLEDevice.lookups,session.stale_bond_cleared),([],bonded,[],False))
        # A failure while Windows cannot say whether the watch is paired is reported as it is.
        FakeClient.bonded=True;FakeClient.stale='connect';FakeClient.clients=[];FakeLEDevice.missing=True
        session=windows_session()
        with self.assertRaises(BleakError):await session.connect('COROS PACE Pro TEST')
        self.assertEqual((session.step,FakeClient.unpairs,len(FakeClient.clients),session.stale_bond_cleared),('connect',[],1,False))
        # BlueZ manages its own bonds: no lookup, no unpair.
        FakeLEDevice.missing=False;FakeLEDevice.lookups=[];FakeClient.clients=[]
        original=sys.platform;sys.platform='linux'
        try:session=Session()
        finally:sys.platform=original
        with self.assertRaises(BleakError):await session.connect('COROS PACE Pro TEST')
        self.assertEqual((session.step,FakeClient.unpairs,FakeLEDevice.lookups,len(FakeClient.clients)),('connect',[],[],1))
    async def test_failed_pairing_keeps_the_bond(self):
        # The watch asked for a bond and pairing failed: removing the Windows one will not help.
        FakeClient.bonded=True;FakeClient.refuse_unpaired=True;FakeClient.pair_error='Could not pair with device: REJECTED_BY_OTHER_END'
        session=windows_session()
        with self.assertRaises(BleakError):await session.connect('COROS PACE Pro TEST')
        self.assertEqual((session.step,FakeClient.unpairs,FakeClient.bonded,len(FakeClient.clients)),('pair',[],True,1))
    async def test_stale_bond_reports(self):
        # The retry fails at pairing: that step is reported, with only the retry's own causes.
        FakeClient.bonded=True;FakeClient.stale='connect'
        FakeClient.refuse_unpaired=True;FakeClient.pair_error='Could not pair with device: REJECTED_BY_OTHER_END'
        reply=(await run_main(CONNECT))[-1]
        self.assertTrue(reply['error'].startswith('System Bluetooth failed while pairing with the watch (rejected by other end).'),reply['error'])
        self.assertEqual({key:reply['detail'][key] for key in ['step','reason','staleBondCleared','causes']},
                         {'step':'pair','reason':'rejected by other end','staleBondCleared':True,'causes':['BleakGATTProtocolError']})
        self.assertEqual(FakeClient.unpairs,[False])
        # Windows refuses to unpair: removing the watch by hand is what is left.
        FakeClient.bonded=True;FakeClient.refuse_unpaired=False;FakeClient.pair_error=None
        FakeClient.unpair_error='Could not unpair with device: 3';FakeClient.unpairs=[]
        reply=(await run_main(CONNECT))[-1]
        self.assertEqual(reply['error'],'System Bluetooth failed while removing the old Windows pairing (access denied). '
                                        'Remove the watch under Settings → Bluetooth & devices, then try again.')
        self.assertEqual((reply['detail']['step'],reply['detail']['reason'],'staleBondCleared' in reply['detail']),('unpair','access denied',False))
        # A retry that connects leaves an event for the Bluetooth trail, ahead of the reply.
        FakeClient.unpair_error=None;FakeClient.unpairs=[]
        emitted=await run_main(CONNECT)
        self.assertEqual(emitted[1],{'event':'stale bond cleared'})
        self.assertTrue(emitted[2]['result']['connected']);self.assertNotIn('error',emitted[2])
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
        self.assertEqual(reason(BleakError('Could not unpair with device: 4')),'unpairing failed')
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
