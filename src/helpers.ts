import { sesClient } from "./utils/sesClient";
import { SendEmailCommand } from "@aws-sdk/client-ses";

export const validateDate = (dateStr: string): boolean => {
  const date = new Date(dateStr);
  return !isNaN(date.getTime());
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
}): Promise<void> => {
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
  } catch (error) {}
};

export const getErrorObj = (name: string, message?: string): Error => {
  const err = new Error(message);
  err.name = name;

  return err;
}
