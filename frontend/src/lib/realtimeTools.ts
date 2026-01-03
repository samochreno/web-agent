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
    name: "list_task_lists",
    description:
      "List Google task lists that the user has connected. Always refer to returned IDs as aliases.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "list_tasks",
    description:
      "List tasks from a specific list, optionally filtered by a start and end date. Use the alias for task_list_id from previous responses.",
    parameters: {
      type: "object",
      properties: {
        task_list_id: {
          type: "string",
          description: "Alias for the target task list.",
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
      "Create a new Google task in the specified list (or the default list if none is provided). Do not include raw Google IDs—use alias IDs only.",
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
          description: "Alias of the task list to create the task in.",
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
      "Update a Google task using the alias IDs provided earlier. Only send fields that need to change.",
    parameters: {
      type: "object",
      required: ["task_id"],
      properties: {
        task_id: {
          type: "string",
          description: "Alias for the task to update.",
        },
        task_list_id: {
          type: "string",
          description: "Alias for the task list that contains the task.",
        },
        title: { type: "string", description: "Updated task title." },
        notes: { type: "string", description: "Updated notes or description." },
        due_date: {
          type: "string",
          description:
            "Optional updated due date in YYYY-MM-DD format. Omit to leave unchanged; send empty string to clear.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "list_events",
    description:
      "List calendar events across the user's allowed calendars. You must provide a start_date and end_date range in ISO format (YYYY-MM-DD). Returned IDs are aliases.",
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
      "Update a calendar event using its alias event_id. Events from readonly calendars will be rejected by the server.",
    parameters: {
      type: "object",
      required: ["event_id"],
      properties: {
        event_id: {
          type: "string",
          description: "Alias for the event to update.",
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
