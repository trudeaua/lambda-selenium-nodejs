# lambda-selenium-nodejs
Web scraper utilizing Selenium WebDriver + Node.js built deployed as a Lambda function running a Docker image. Designed for scraping a website for a PDF report file, and then uploading the report to Google Drive and sending notifications with the Gmail API.


# Setup
1. Ensure you have Node.js >= 18, Docker installed on your system
    - [Optional for local development] Have Chromium binary + Chromedriver installed on your system
2. Download or clone this repository
3. Install dependencies by running the following command
```
yarn
```
4. Create an EC2 repository by running the following command
```
aws ecr create-repository --repository-name <REPO BASE NAME>-<STAGE>-<FUNCTION> --image-scanning-configuration scanOnPush=true --image-tag-mutability MUTABLE
```

The `<REPO BASE NAME>-<STAGE>-<FUNCTION>` format is so that Serverless can detect the repository that the function image is located at. See [https://www.serverless.com/blog/container-support-for-lambda](https://www.serverless.com/blog/container-support-for-lambda)

5. Build the Docker image and push it to ECR
```bash
cd scripts
sh build.sh -a <AWS ACCOUNT ID> -e <ENVIRONMENT or STAGE> -n <REPO BASE NAME> -f <FUNCTION> -r <AWS REGION>
```
6. Deploy Serverless framework
```
yarn sls deploy --stage <STAGE>
```
