import {SESClient} from "@aws-sdk/client-ses"

export const sesClient = new SESClient({ region: "ap-south-1" });