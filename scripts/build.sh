#!/bin/bash  

usage() {
    cat <<USAGE

    Usage: $0 [-a accountId] [-e environment] [--skip-build]

    Options:
        -a, --accountId:            AWS account ID
        -e, --environment:          Environment name e.g. production
        -n, --name:                 EC2 repository base name 
        -f, --function-name:        Serverless function name
        -r, --region:               AWS region to deploy to
        --skip-build:               Skip building the docker image for the EC2 worker
USAGE
    exit 1
}


if [ $# -eq 0 ]; then
    usage
    exit 1
fi

skipBuild=false
environment=
accountId=
name="ar-reports-scraper"
region="ca-central-1"
functionName="main"

while [ "$1" != "" ]; do
    case $1 in
    --skip-build)
        SKIP_VERIFICATION=true
        ;;
    -e | --environment)
        shift
        environment=$1
        ;;
    -a | --accountId)
        shift
        accountId=$1
        ;;
    -n | --name)
        shift
        name=$1
        ;;
    -r | --region)
        shift
        region=$1
        ;;
    -f | --function-name)
        shift
        functionName=$1
        ;;
    -h | --help)
        usage
        ;;
    *)
        usage
        exit 1
        ;;
    esac
    shift
done



cd ..
if [ $skipBuild == false ]
then
    aws ecr get-login-password --region $region | docker login --username AWS --password-stdin $accountId.dkr.ecr.ca-central-1.amazonaws.com
    docker build -t ${name}-${environment}-${functionName} .
    docker tag  ${name}-${environment}-${functionName}:latest $accountId.dkr.ecr.ca-central-1.amazonaws.com/${name}-${environment}-${functionName}:latest
    docker push $accountId.dkr.ecr.ca-central-1.amazonaws.com/${name}-${environment}-${functionName}:latest
fi
cd scripts