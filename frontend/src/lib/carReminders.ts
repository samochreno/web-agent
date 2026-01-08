import { useCallback, useEffect, useRef } from "react";
import { registerPlugin } from "@capacitor/core";
import {
  LocalNotifications,
  type LocalNotificationsPlugin,
  type PermissionStatus as NotificationPermissionStatus,
  type Channel,
  type ScheduleOptions,
} from "@capacitor/local-notifications";
import { fireReminders, type TriggerReminder } from "./api";
import { isNativePlatform, getPlatform } from "./config";

type PermissionStatus = {
  notifications?: string;
  motion?: string;
};

type CarDetectionEvent = { timestamp?: string };

type CarDetectionPlugin = {
  requestPermissions(): Promise<PermissionStatus>;
  startDetection(options?: { debounceMs?: number }): Promise<void>;
  stopDetection(): Promise<void>;
  addListener(
    eventName: "enteredCar" | "exitedCar" | "permissionStatusChanged",
    listenerFunc: (event: CarDetectionEvent) => void
  ): Promise<{ remove: () => void }>;
};

const CarDetection = registerPlugin<CarDetectionPlugin>("CarDetection");

const notifications = LocalNotifications as unknown as LocalNotificationsPlugin;
const ANDROID_IMPORTANCE_HIGH: Channel["importance"] = 5;
const ANDROID_VISIBILITY_PUBLIC: Channel["visibility"] = 1;

async function ensureNotificationPermission(): Promise<boolean> {
  try {
    const current: NotificationPermissionStatus | undefined =
      await notifications.checkPermissions();
    if (current?.display === "granted") return true;
    const next: NotificationPermissionStatus | undefined =
      await notifications.requestPermissions();
    return next?.display === "granted";
  } catch (err) {
    console.warn("Notification permission request failed", err);
    return false;
  }
}

function notificationId(base: number, offset: number): number {
  const maxId = 2_000_000_000;
  return Math.abs(Math.floor((base + offset) % maxId));
}

function buildNotificationTitle(triggerType: string): string {
  return triggerType === "enter_car" ? "You're in the car" : "You left the car";
}

function buildNotificationBody(reminder: TriggerReminder): string {
  return reminder.text || "Reminder";
}

export function useCarReminderBridge(enabled: boolean) {
  const channelCreatedRef = useRef(false);

  const ensureChannel = useCallback(async () => {
    if (channelCreatedRef.current || getPlatform() !== "android") return;
    try {
      const channel: Channel = {
        id: "car-events",
        name: "Car Events",
        description: "Reminders when you enter or exit your car",
        importance: ANDROID_IMPORTANCE_HIGH,
        visibility: ANDROID_VISIBILITY_PUBLIC,
      };
      await notifications.createChannel(channel);
      channelCreatedRef.current = true;
    } catch (err) {
      console.warn("Unable to create notification channel", err);
    }
  }, []);

  const handleTrigger = useCallback(
    async (triggerType: "enter_car" | "exit_car", ownerId?: string) => {
      if (!isNativePlatform() || getPlatform() !== "ios") return;
      const granted = await ensureNotificationPermission();
      if (!granted) return;
      await ensureChannel();

      try {
        const result = await fireReminders(triggerType, ownerId);
        const reminders = result.reminders || [];
        if (!reminders.length) return;

        const now = Date.now();
        const schedulePayload: ScheduleOptions = {
          notifications: reminders.map((reminder, index) => ({
            id: notificationId(now, index),
            title: buildNotificationTitle(triggerType),
            body: buildNotificationBody(reminder),
            schedule: { at: new Date(now + 500 + index * 100) },
            channelId: getPlatform() === "android" ? "car-events" : undefined,
            extra: {
              reminderId: reminder.id,
              triggerType,
              googleTaskId:
                reminder.google_task_alias || reminder.google_task_id,
            },
          })),
        };
        await notifications.schedule(schedulePayload);
      } catch (err) {
        console.warn("Failed to dispatch car reminder notification", err);
      }
    },
    [ensureChannel]
  );

  useEffect(() => {
    const platform = getPlatform();
    if (!enabled || !isNativePlatform() || platform !== "ios") return;
    const listeners: Array<{ remove: () => void }> = [];

    const setup = async () => {
      try {
        await ensureNotificationPermission();
        await ensureChannel();
        await CarDetection.requestPermissions();
      } catch (err) {
        console.warn("CarDetection permission setup failed", err);
      }

      try {
        listeners.push(
          await CarDetection.addListener(
            "enteredCar",
            () => void handleTrigger("enter_car")
          )
        );
        listeners.push(
          await CarDetection.addListener(
            "exitedCar",
            () => void handleTrigger("exit_car")
          )
        );
        listeners.push(
          await CarDetection.addListener("permissionStatusChanged", () => {
            // no-op for now; listeners keep state up to date
          })
        );
        await CarDetection.startDetection({ debounceMs: 20_000 });
      } catch (err) {
        console.warn("CarDetection start failed", err);
      }
    };

    void setup();

    return () => {
      listeners.forEach((listener) => {
        try {
          listener.remove();
        } catch (err) {
          console.warn("CarDetection listener cleanup failed", err);
        }
      });
      void CarDetection.stopDetection();
    };
  }, [enabled, ensureChannel, handleTrigger]);

  // Debug helper: expose a manual trigger for Safari Web Inspector on device.
  useEffect(() => {
    if (!isNativePlatform()) return;
    const globalAny = globalThis as Record<string, unknown>;
    globalAny.fireReminders = (
      triggerType: "enter_car" | "exit_car",
      ownerId?: string
    ) => handleTrigger(triggerType, ownerId);
    return () => {
      delete globalAny.fireReminders;
    };
  }, [handleTrigger]);
}
