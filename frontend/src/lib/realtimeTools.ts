export type RealtimeToolDefinition = {
  type: "function";
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, ToolPropertySchema>;
    required?: string[];
    additionalProperties?: boolean;
  };
};

type ToolPropertySchema = {
  type: string;
  description?: string;
  enum?: string[];
  pattern?: string;
  properties?: Record<string, ToolPropertySchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: ToolPropertySchema;
};

export const realtimeTools: RealtimeToolDefinition[] = [
  {
    type: "function",
    name: "get_current_datetime",
    description:
      "Returns the current date, time, weekday, and timezone information.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "schedule_trigger_reminder",
    description:
      "Create a reminder that fires on a specific trigger. Use for car entry/exit: set trigger_type to enter_car or exit_car. The app will notify locally and create a Google Task when it fires.",
    parameters: {
      type: "object",
      required: ["text", "trigger_type"],
      properties: {
        text: {
          type: "string",
          description: "What to remind the user about when the trigger fires.",
        },
        trigger_type: {
          type: "string",
          enum: ["enter_car", "exit_car"],
          description:
            "Trigger to attach to. enter_car fires when Bluetooth audio connects AND motion is automotive; exit_car when leaving the car.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "list_task_lists",
    description: "List Google task lists that the user has connected.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "list_tasks",
    description:
      "List tasks from a specific list, optionally filtered by a start and end date. Use the task_list_id from previous responses.",
    parameters: {
      type: "object",
      properties: {
        task_list_id: {
          type: "string",
          description: "ID of the target task list from a previous response.",
        },
        start_date: {
          type: "string",
          description:
            "Optional ISO date (YYYY-MM-DD) to include tasks due on or after this date.",
        },
        end_date: {
          type: "string",
          description:
            "Optional ISO date (YYYY-MM-DD) to include tasks due on or before this date.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "create_task",
    description:
      "Create a new Google task in the specified list (or the default list if none is provided).",
    parameters: {
      type: "object",
      required: ["title"],
      properties: {
        title: { type: "string", description: "Task title." },
        notes: {
          type: "string",
          description: "Optional task notes or details.",
        },
        task_list_id: {
          type: "string",
          description: "ID of the task list to create the task in.",
        },
        due_date: {
          type: "string",
          description: "Optional due date in YYYY-MM-DD format.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "update_task",
    description:
      "Update a Google task. Only send fields that need to change. To mark a task done you MUST set status to completed; omitting status keeps the current value.",
    parameters: {
      type: "object",
      required: ["task_id"],
      properties: {
        task_id: {
          type: "string",
          description: "ID for the task to update from a previous response.",
        },
        task_list_id: {
          type: "string",
          description: "ID for the task list that contains the task.",
        },
        title: { type: "string", description: "Updated task title." },
        notes: { type: "string", description: "Updated notes or description." },
        due_date: {
          type: "string",
          description:
            "Optional updated due date in YYYY-MM-DD format. Omit to leave unchanged; send empty string to clear.",
        },
        status: {
          type: "string",
          enum: ["needsAction", "completed"],
          description:
            "Use completed to mark the task done; leaving this out keeps the current status.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "list_events",
    description:
      "List calendar events across the user's calendars. You must provide a start_date and end_date range in ISO format (YYYY-MM-DD).",
    parameters: {
      type: "object",
      required: ["start_date", "end_date"],
      properties: {
        start_date: {
          type: "string",
          description: "Start of the window (YYYY-MM-DD).",
        },
        end_date: {
          type: "string",
          description: "End of the window (YYYY-MM-DD).",
        },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "create_event",
    description:
      "Create a calendar event on the user's primary calendar. Prefer start_datetime/end_datetime in ISO-8601, otherwise provide date with start_time/end_time (HH:MM).",
    parameters: {
      type: "object",
      required: ["summary"],
      properties: {
        summary: { type: "string", description: "Event title." },
        notes: { type: "string", description: "Optional event description." },
        location: { type: "string", description: "Optional event location." },
        start_datetime: {
          type: "string",
          description:
            "ISO-8601 start datetime in the user's timezone (e.g., 2025-01-02T15:00).",
        },
        end_datetime: {
          type: "string",
          description:
            "ISO-8601 end datetime in the user's timezone (e.g., 2025-01-02T16:00).",
        },
        date: {
          type: "string",
          description:
            "Date for the event if using date + time inputs (YYYY-MM-DD).",
        },
        start_time: {
          type: "string",
          description:
            "Start time (HH:MM, 24-hour) used when start_datetime is not provided.",
        },
        end_time: {
          type: "string",
          description:
            "End time (HH:MM, 24-hour) used when end_datetime is not provided.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "update_event",
    description:
      "Update a calendar event. Events from readonly calendars will be rejected by the server.",
    parameters: {
      type: "object",
      required: ["event_id"],
      properties: {
        event_id: {
          type: "string",
          description: "ID for the event to update from a previous response.",
        },
        title: { type: "string", description: "Updated event title." },
        notes: { type: "string", description: "Updated description." },
        location: { type: "string", description: "Updated location." },
        start_datetime: {
          type: "string",
          description: "New start datetime in ISO-8601 format.",
        },
        end_datetime: {
          type: "string",
          description: "New end datetime in ISO-8601 format.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "web_search",
    description: "Performs a web search for the specified query.",
    parameters: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string", description: "The search query." },
      },
      additionalProperties: false,
    },
  },
];
