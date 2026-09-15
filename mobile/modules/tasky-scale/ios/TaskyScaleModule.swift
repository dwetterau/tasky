import ExpoModulesCore
import CoreBluetooth

public final class TaskyScaleModule: Module {
  private var client: ScaleClient?

  public func definition() -> ModuleDefinition {
    Name("TaskyScale")
    Events("onScaleEvent")
    AsyncFunction("scan") { () in
      if self.client == nil {
        self.client = ScaleClient { [weak self] event in
          self?.sendEvent("onScaleEvent", event)
        }
      }
      self.client?.scan()
    }.runOnQueue(.main)
    AsyncFunction("connect") { (id: String) in self.client?.connect(id) }.runOnQueue(.main)
    AsyncFunction("stop") { () in self.client?.stop() }.runOnQueue(.main)
    OnDestroy {
      let client = self.client
      DispatchQueue.main.async { client?.stop() }
    }
  }
}

private final class ScaleClient: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
  private let emit: ([String: Any]) -> Void
  private var central: CBCentralManager!
  private var devices: [String: CBPeripheral] = [:]
  private var selected: CBPeripheral?
  private var deadline: DispatchWorkItem?
  private var wantsScan = false
  private var command: CBCharacteristic?
  private var measurement: CBCharacteristic?
  private var pendingServices = 0
  private var ready = false
  private let measurementService = CBUUID(string: "FFE0")
  private let commandService = CBUUID(string: "FFE5")

  init(emit: @escaping ([String: Any]) -> Void) {
    self.emit = emit
    super.init()
    central = CBCentralManager(delegate: self, queue: .main)
  }

  private func status(_ state: String, _ message: String) {
    emit(["type": "status", "state": state, "message": message])
  }

  private func timeout(_ seconds: Double, _ message: String) {
    deadline?.cancel()
    let work = DispatchWorkItem { [weak self] in self?.fail(message) }
    deadline = work
    DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: work)
  }

  func scan() {
    stop(announce: false)
    devices.removeAll()
    wantsScan = true
    timeout(30, "No scale selected. Wake the scale, keep it nearby, and try again.")
    if central.state == .poweredOn { beginScan() }
    else { centralManagerDidUpdateState(central) }
  }

  private func beginScan() {
    guard wantsScan else { return }
    status("scanning", "Wake your scale, then select it below.")
    // Older Minis may advertise only a name, without the service UUID.
    central.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
  }

  func connect(_ id: String) {
    guard wantsScan, central.state == .poweredOn, let peripheral = devices[id] else {
      fail("Scale is no longer available. Search again."); return
    }
    wantsScan = false
    central.stopScan()
    selected = peripheral
    peripheral.delegate = self
    status("connecting", "Connecting to \(peripheral.name ?? "scale")…")
    timeout(20, "Could not connect. Wake the scale and try again.")
    central.connect(peripheral)
  }

  func stop(announce: Bool = true) {
    wantsScan = false
    deadline?.cancel()
    deadline = nil
    if central.state == .poweredOn { central.stopScan() }
    let previous = selected
    selected = nil
    previous?.delegate = nil
    if let previous, previous.state != .disconnected { central.cancelPeripheralConnection(previous) }
    command = nil
    measurement = nil
    pendingServices = 0
    ready = false
    if announce { status("idle", "Scale connection stopped.") }
  }

  private func fail(_ message: String) {
    stop(announce: false)
    status("error", message)
  }

  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    switch central.state {
    case .poweredOn: if wantsScan { beginScan() }
    case .unauthorized: fail("Allow Tasky to use Bluetooth in iPhone Settings.")
    case .poweredOff: fail("Turn on Bluetooth in iPhone Settings, then search again.")
    case .unsupported: fail("Bluetooth is unavailable. Use a physical iPhone.")
    default: if wantsScan { status("scanning", "Waiting for Bluetooth…") }
    }
  }

  func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
                      advertisementData: [String: Any], rssi RSSI: NSNumber) {
    guard wantsScan else { return }
    let name = advertisementData[CBAdvertisementDataLocalNameKey] as? String ?? peripheral.name ?? ""
    let services = advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID] ?? []
    guard name.uppercased().contains("YUNMAI") || name.uppercased().contains("YNUMAI") || services.contains(measurementService) else { return }
    let id = peripheral.identifier.uuidString
    devices[id] = peripheral
    emit(["type": "device", "id": id, "name": name.isEmpty ? "Nearby scale" : name, "rssi": RSSI])
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    guard peripheral === selected else { central.cancelPeripheralConnection(peripheral); return }
    peripheral.discoverServices([measurementService, commandService])
  }

  func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
    guard peripheral === selected else { return }
    fail(error?.localizedDescription ?? "Connection failed. Wake the scale and try again.")
  }

  func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
    guard peripheral === selected else { return }
    stop(announce: false)
    status("idle", "Scale disconnected. Any completed reading is still available below.")
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    guard peripheral === selected else { return }
    if let error { fail(error.localizedDescription); return }
    let services = peripheral.services ?? []
    guard services.contains(where: { $0.uuid == measurementService }) else {
      fail("This scale uses a different Bluetooth protocol. Share diagnostics so we can add support."); return
    }
    pendingServices = services.count
    for service in services { peripheral.discoverCharacteristics(nil, for: service) }
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
    guard peripheral === selected else { return }
    if let error { fail(error.localizedDescription); return }
    for characteristic in service.characteristics ?? [] {
      emit(["type": "detail", "message": "Service \(service.uuid), characteristic \(characteristic.uuid), properties \(characteristic.properties.rawValue)"])
      if service.uuid == measurementService && characteristic.uuid == CBUUID(string: "FFE4") { measurement = characteristic }
      if service.uuid == commandService && characteristic.uuid == CBUUID(string: "FFE9") { command = characteristic }
    }
    pendingServices -= 1
    guard pendingServices == 0 else { return }
    guard let measurement, measurement.properties.contains(.notify) || measurement.properties.contains(.indicate) else {
      fail("The scale's measurement channel was not found. Share diagnostics."); return
    }
    peripheral.setNotifyValue(true, for: measurement)
  }

  func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
    guard peripheral === selected else { return }
    if let error { fail(error.localizedDescription); return }
    guard characteristic === measurement, characteristic.isNotifying, !ready else { return }
    ready = true
    // Read the protocol version to wake compatible Minis; preserve the scale's existing profile and clock.
    if let command {
      let packet = Data([0x0d, 0x05, 0x13, 0x00, 0x16])
      if command.properties.contains(.write) { peripheral.writeValue(packet, for: command, type: .withResponse) }
      else if command.properties.contains(.writeWithoutResponse) { peripheral.writeValue(packet, for: command, type: .withoutResponse) }
      emit(["type": "detail", "message": "Requested protocol version: 0d05130016"])
    }
    status("connected", "Step on the scale and stay still until the reading is complete.")
    timeout(90, "Weigh-in timed out. Connect again when you're ready.")
  }

  func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
    guard peripheral === selected else { return }
    if let error { fail(error.localizedDescription) }
  }

  func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
    guard peripheral === selected else { return }
    if let error { fail(error.localizedDescription); return }
    guard characteristic === measurement, let data = characteristic.value else { return }
    emit(["type": "packet", "id": peripheral.identifier.uuidString,
          "hex": data.map { String(format: "%02x", $0) }.joined(),
          "receivedAt": Date().timeIntervalSince1970 * 1000])
    timeout(90, "Weigh-in timed out. Connect again when you're ready.")
  }
}
