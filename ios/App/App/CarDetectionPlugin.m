#import <Capacitor/Capacitor.h>

CAP_PLUGIN(CarDetectionPlugin, "CarDetection",
           CAP_PLUGIN_METHOD(requestPermissions, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(startDetection, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(stopDetection, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(currentStatus, CAPPluginReturnPromise);
)
