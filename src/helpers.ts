import { sesClient } from "./utils/sesClient";
import { SendEmailCommand } from "@aws-sdk/client-ses";

export const validateDate = (dateStr: string): boolean => {
  const date = new Date(dateStr);
  return !Number.isNaN(date.getTime());
};

export const validateTime = (timeStr: string): boolean => {
  const timeRegex = /^([0-1]?\d|2[0-3]):([0-5]\d)$/; // HH:MM 24-hour format
  return timeRegex.test(timeStr);
};

export const sendEmailNotification = async ({
  sender,
  recipients,
  subject,
  bodyText,
  bodyHtml,
}: {
  sender: string;
  recipients: string[];
  subject: string;
  bodyText: string;
  bodyHtml?: string;
}): Promise<any> => {
  try {
    const sendCommand = new SendEmailCommand({
      Source: sender,
      Destination: {
        ToAddresses: recipients,
      },
      Message: {
        Subject: {
          Data: subject,
        },
        Body: {
          Text: {
            Data: bodyText,
          },
          Html: {
            Data: bodyHtml,
          },
        },
      },
    });

    return await sesClient.send(sendCommand);
  } catch (error) {
    console.error("Error sending email:", error);
    throw error;
  }
};

export const getErrorObj = (name: string, message?: string): Error => {
  const err = new Error(message);
  err.name = name;

  return err;
};

const validateDateAndFormat = (
  from: string,
  to: string,
  fromTime?: string,
  toTime?: string
): { valid: boolean; message?: string } => {
  if (!validateDate(from) || !validateDate(to)) {
    return {
      valid: false,
      message: "Invalid date format ex: (MM/DD/YYYY), (YYYY-MM-DD)",
    };
  }

  if (fromTime && !validateTime(fromTime)) {
    return {
      valid: false,
      message: "Invalid fromTime format. Expected HH:MM in 24-hour format.",
    };
  }

  if (toTime && !validateTime(toTime)) {
    return {
      valid: false,
      message: "Invalid toTime format. Expected HH:MM in 24-hour format.",
    };
  }

  return { valid: true };
};

const buildDateTime = (
  dateStr: string,
  timeStr?: string,
  defaultToEnd = false
): Date => {
  const date = new Date(dateStr);
  if (timeStr) {
    const [hours, minutes] = timeStr.split(":").map(Number);
    date.setHours(hours, minutes, 0, 0);
  } else if (defaultToEnd) {
    date.setHours(23, 59, 59, 999);
  } else {
    date.setHours(0, 0, 0, 0);
  }
  return date;
};

const validateFromToOrder = (
  from: string,
  to: string,
  fromTime?: string,
  toTime?: string
): { valid: boolean; message?: string } => {
  // Full day leave (no times provided)
  if (!fromTime && !toTime) {
    const fromDate = buildDateTime(from);
    const toDate = buildDateTime(to);
    if (fromDate > toDate) {
      return {
        valid: false,
        message: "from date cannot be later than to date",
      };
    }
    return { valid: true };
  }

  // Partial day or timed leave
  const startDateTime = buildDateTime(from, fromTime);
  const endDateTime = buildDateTime(to, toTime, true);

  if (startDateTime > endDateTime) {
    let message = "from date and time cannot be later than to date and time";
    if (fromTime && !toTime) {
      message = "from date and time cannot be later than to date";
    } else if (!fromTime && toTime) {
      message = "from date cannot be later than to date and time";
    }
    return { valid: false, message };
  }

  return { valid: true };
};

const validateNotPast = (
  from: string,
  fromTime?: string
): { valid: boolean; message?: string } => {
  if (fromTime) {
    const [fromHours, fromMinutes] = fromTime.split(":").map(Number);
    const fromDateTime = new Date(from);
    fromDateTime.setHours(fromHours, fromMinutes, 0, 0);

    const now = new Date();
    if (fromDateTime < now) {
      return {
        valid: false,
        message: "from date and time cannot be in the past",
      };
    }
  }

  if (new Date(from) < new Date()) {
    return {
      valid: false,
      message: "from date and time cannot be in the past",
    };
  }

  return { valid: true };
};

export const validateDateInputs = (
  from: string,
  to: string,
  fromTime?: string,
  toTime?: string
): { valid: boolean; message?: string } => {
  const validations = [
    validateDateAndFormat(from, to, fromTime, toTime),
    validateFromToOrder(from, to, fromTime, toTime),
    validateNotPast(from, fromTime),
  ];

  for (const result of validations) {
    if (!result.valid) {
      return result;
    }
  }

  return { valid: true };
};
