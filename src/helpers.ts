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
}

export const getTimeoutSeconds = (from: Date, to: Date): number => {
  new Date().
}
