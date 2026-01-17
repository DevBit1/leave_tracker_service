import { sesClient } from "./utils/sesClient";
import { SendEmailCommand } from "@aws-sdk/client-ses";

export const validateDate = (dateStr: string): boolean => {
  const date = new Date(dateStr);
  return !isNaN(date.getTime());
};

export const validateTime = (timeStr: string): boolean => {
  const timeRegex = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/; // HH:MM 24-hour format
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

export const validateDateInputs = (
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

  const fromDate = new Date(from);
  const toDate = new Date(to);

  // Full day leave (no times provided) - from must be less than or equal to to
  if (!fromTime && !toTime) {
    if (fromDate > toDate) {
      return {
        valid: false,
        message: "from date cannot be later than to date",
      };
    }
  }

  // Half day or specific time leave
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

    if (toTime) {
      const [toHours, toMinutes] = toTime.split(":").map(Number);
      const toDateTime = new Date(to);
      toDateTime.setHours(toHours, toMinutes, 0, 0);

      if (fromDateTime > toDateTime) {
        return {
          valid: false,
          message: "from date and time cannot be later than to date and time",
        };
      }
    } else {
      // fromTime provided but toTime not provided - from with time must be before end of to date
      toDate.setHours(23, 59, 59, 999);
      if (fromDateTime > toDate) {
        return {
          valid: false,
          message: "from date and time cannot be later than to date",
        };
      }
    }
  } else if (toTime) {
    // toTime provided but fromTime not provided - from (start of day) must be before toTime
    const [toHours, toMinutes] = toTime.split(":").map(Number);
    const toDateTime = new Date(to);
    toDateTime.setHours(toHours, toMinutes, 0, 0);

    fromDate.setHours(0, 0, 0, 0);
    if (fromDate > toDateTime) {
      return {
        valid: false,
        message: "from date cannot be later than to date and time",
      };
    }
  }

  if (fromDate < new Date()) {
    return {
      valid: false,
      message: "from date and time cannot be in the past",
    };
  }

  return { valid: true };
};
