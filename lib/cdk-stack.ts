import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { Passwordless } from "./cognito-passworless";

export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    /** Create User Pool */
    const userPool = new cdk.aws_cognito.UserPool(this, "UserPool", {
      signInAliases: {
        username: true,
        phone: true,
        email: true,
      },
      passwordPolicy: {
        minLength: 8,
        requireDigits: true,
        requireUppercase: true,
        requireLowercase: true,
        requireSymbols: true,
      },
    });

    /** Bucket for Web App assets */
    const bucket = new cdk.aws_s3.Bucket(this, "Bucket", {
      enforceSSL: true,
      blockPublicAccess: cdk.aws_s3.BlockPublicAccess.BLOCK_ALL,
      autoDeleteObjects: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    /** OAI for secure bucket access by CloudFront */
    const originAccessIdentity = new cdk.aws_cloudfront.OriginAccessIdentity(
      this,
      "OAI"
    );

    /** CloudFront distribution to serve Web app from S3 bucket */
    const distribution = new cdk.aws_cloudfront.Distribution(
      this,
      "Distribution",
      {
        defaultBehavior: {
          origin: new cdk.aws_cloudfront_origins.S3Origin(bucket, {
            originAccessIdentity,
          }),
          viewerProtocolPolicy:
            cdk.aws_cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          responseHeadersPolicy:
            cdk.aws_cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
        },
        defaultRootObject: "index.html",
        errorResponses: [{ httpStatus: 403, responsePagePath: "/index.html" }],
      }
    );

    /** Add Passwordless authentication to the User Pool */
    const passwordless = new Passwordless(this, "Kynet", {
      userPool,
      allowedOrigins: [
        process.env.WS_PREVIEW_URL!,
        `https://${distribution.distributionDomainName}`,
      ],
      fido2: {
        allowedRelyingPartyIds: [
          process.env.WS_PREVIEW_HOST!,
          distribution.distributionDomainName,
        ],
      },
      magicLink: {
        autoConfirmUsers: true,
        sesFromAddress: process.env.WS_EMAIL!,
      },
    });

    /** Add test user to User Pool */
    const user = new cdk.aws_cognito.CfnUserPoolUser(this, "lgabx", {
      userPoolId: passwordless.userPool.userPoolId,
      username: process.env.WS_EMAIL!,
      messageAction: "SUPPRESS",
      userAttributes: [
        {
          name: "email",
          value: process.env.WS_EMAIL!,
        },
        {
          name: "email_verified",
          value: "true",
        },
      ],
    });
    user.node.addDependency(userPool.node.findChild("PreSignUpCognito"));

    /** Verify email address of test user */
    new cdk.aws_ses.EmailIdentity(this, "SesVerification", {
      identity: cdk.aws_ses.Identity.email(process.env.WS_EMAIL!),
    });

    /** Let's grab the ClientId that the Passwordless solution created for us */
    new cdk.CfnOutput(this, "ClientId", {
      value: passwordless.userPoolClients!.at(0)!.userPoolClientId,
    });

    /** Let's grab the FIDO2 API base URL. This is the API with which (signed-in) users can manage FIDO2 credentials */
    new cdk.CfnOutput(this, "Fido2Url", {
      value: passwordless.fido2Api!.url!,
    });

    /** Let's grab the bucket name where we'll need to upload the front end to */
    new cdk.CfnOutput(this, "BucketName", {
      value: bucket.bucketName,
    });

    /** Let's grab the CloudFront distribution URL, we'll need it for accessing the front end */
    new cdk.CfnOutput(this, "WebAppUrl", {
      value: `https://${distribution.distributionDomainName}`,
    });
  }
}
