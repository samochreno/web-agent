import Foundation
import Capacitor
import CoreMotion
import AVFoundation
import UserNotifications

@objc(CarDetectionPlugin)
public class CarDetectionPlugin: CAPPlugin {
    private let motionManager = CMMotionActivityManager()
    private var routeObserver: NSObjectProtocol?
    private var isAutomotive = false
    private var isBluetoothRoute = false
    private var isInCar = false
    private var debounceSeconds: TimeInterval = 20
    private var lastTransition = Date.distantPast
    private let isoFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
    private let debugNotificationCenter = UNUserNotificationCenter.current()

    @objc public override func load() {
        super.load()
    }

    @objc func requestPermissions(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            DispatchQueue.main.async {
                let motionStatus = self.motionStatus()
                let notifStatus = granted ? "granted" : "denied"
                self.notifyListeners("permissionStatusChanged", data: [
                    "notifications": notifStatus,
                    "motion": motionStatus
                ])
                call.resolve([
                    "notifications": notifStatus,
                    "motion": motionStatus
                ])
            }
        }
    }

    @objc func startDetection(_ call: CAPPluginCall) {
        if let debounceMs = call.getInt("debounceMs") {
            debounceSeconds = TimeInterval(debounceMs) / 1000.0
        }
        startRouteObservation()
        startMotionUpdates()
        call.resolve([
            "inCar": isInCar,
            "motion": motionStatus(),
            "bluetooth": isBluetoothRoute
        ])
    }

    @objc func stopDetection(_ call: CAPPluginCall) {
        stopRouteObservation()
        stopMotionUpdates()
        call.resolve()
    }

    @objc func currentStatus(_ call: CAPPluginCall) {
        call.resolve([
            "inCar": isInCar,
            "motion": motionStatus(),
            "bluetooth": isBluetoothRoute
        ])
    }

    private func startRouteObservation() {
        stopRouteObservation()
        let center = NotificationCenter.default
        routeObserver = center.addObserver(
            forName: AVAudioSession.routeChangeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.updateRouteState()
        }
        updateRouteState()
    }

    private func stopRouteObservation() {
        if let observer = routeObserver {
            NotificationCenter.default.removeObserver(observer)
            routeObserver = nil
        }
    }

    private func startMotionUpdates() {
        guard CMMotionActivityManager.isActivityAvailable() else {
            return
        }
        motionManager.startActivityUpdates(to: OperationQueue.main) { [weak self] activity in
            guard let self = self, let activity = activity else { return }
            let wasAutomotive = self.isAutomotive
            self.isAutomotive = activity.automotive
            if self.isAutomotive != wasAutomotive {
                let title = "Automotive Motion"
                let body = self.isAutomotive ? "Entered automotive state" : "Exited automotive state"
                self.sendDebugNotification(title: title, body: body)
            }
            self.evaluateState()
        }
    }

    private func stopMotionUpdates() {
        motionManager.stopActivityUpdates()
        isAutomotive = false
    }

    private func updateRouteState() {
        let session = AVAudioSession.sharedInstance()
        let outputs = session.currentRoute.outputs
        let wasBluetoothRoute = isBluetoothRoute
        isBluetoothRoute = outputs.contains(where: { output in
            output.portType == .bluetoothA2DP || output.portType == .bluetoothHFP
        })
        if isBluetoothRoute != wasBluetoothRoute {
            let routeNames = outputs.map { $0.portName }.joined(separator: ", ")
            let title = "Bluetooth Audio"
            let body = isBluetoothRoute
                ? "Connected to \(routeNames.isEmpty ? "Bluetooth audio" : routeNames)"
                : "Bluetooth audio disconnected"
            sendDebugNotification(title: title, body: body)
        }
        evaluateState()
    }

    private func evaluateState() {
        let now = Date()
        let shouldBeInCar = isBluetoothRoute && isAutomotive
        guard now.timeIntervalSince(lastTransition) > debounceSeconds else { return }

        if shouldBeInCar && !isInCar {
            isInCar = true
            lastTransition = now
            emit(event: "enteredCar", at: now)
        } else if !shouldBeInCar && isInCar {
            isInCar = false
            lastTransition = now
            emit(event: "exitedCar", at: now)
        }
    }

    private func emit(event: String, at date: Date) {
        notifyListeners(event, data: ["timestamp": isoFormatter.string(from: date)])
        let readableEvent = event == "enteredCar" ? "Entered car" : "Exited car"
        sendDebugNotification(title: "Car Detection", body: readableEvent)
    }

    private func motionStatus() -> String {
        switch CMMotionActivityManager.authorizationStatus() {
        case .authorized:
            return "authorized"
        case .denied:
            return "denied"
        case .restricted:
            return "restricted"
        case .notDetermined:
            return "not_determined"
        @unknown default:
            return "unknown"
        }
    }

    private func sendDebugNotification(title: String, body: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default

        let request = UNNotificationRequest(
            identifier: UUID().uuidString,
            content: content,
            trigger: nil
        )
        debugNotificationCenter.add(request) { error in
            if let error = error {
                NSLog("CarDetection debug notification failed: \(error.localizedDescription)")
            }
        }
    }
}
