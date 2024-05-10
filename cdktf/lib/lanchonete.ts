import {Construct} from "constructs";
import {Fn, TerraformOutput, TerraformStack} from "cdktf";
import {Vpc} from "@cdktf/provider-aws/lib/vpc";
import {Subnet} from "@cdktf/provider-aws/lib/subnet";
import {InternetGateway} from "@cdktf/provider-aws/lib/internet-gateway";
import {RouteTable} from "@cdktf/provider-aws/lib/route-table";
import {RouteTableAssociation} from "@cdktf/provider-aws/lib/route-table-association";
import {SecurityGroup} from "@cdktf/provider-aws/lib/security-group";
import {AwsProvider} from "@cdktf/provider-aws/lib/provider";
import {LaunchTemplate} from "@cdktf/provider-aws/lib/launch-template";
import {PrivateKey} from "@cdktf/provider-tls/lib/private-key";
import {AutoscalingGroup} from "@cdktf/provider-aws/lib/autoscaling-group";
import {Alb} from "@cdktf/provider-aws/lib/alb";
import {AlbTargetGroup} from "@cdktf/provider-aws/lib/alb-target-group";
import {LbListener} from "@cdktf/provider-aws/lib/lb-listener";
import {TlsProvider} from "@cdktf/provider-tls/lib/provider";
import {EcsCluster} from "@cdktf/provider-aws/lib/ecs-cluster";
import {EcsCapacityProvider} from "@cdktf/provider-aws/lib/ecs-capacity-provider";
import {EcsClusterCapacityProviders} from "@cdktf/provider-aws/lib/ecs-cluster-capacity-providers";
import {EcsTaskDefinition} from "@cdktf/provider-aws/lib/ecs-task-definition";
import {EcsService} from "@cdktf/provider-aws/lib/ecs-service";
import {IamRole} from "@cdktf/provider-aws/lib/iam-role";

export class LanchoneteConstruct extends TerraformStack {
    constructor(scope: Construct, id: string, {cidrBlock, prefix}: { cidrBlock: string, prefix: string }) {
        super(scope, id);

        new AwsProvider(this, 'aws', {region: 'us-east-1'});

        new TlsProvider(this, 'tls', {});

        const mainVpc = new Vpc(this, 'vpc', {cidrBlock, enableDnsHostnames: true, tags: {name: 'main', prefix}});

        const createSubnet = (id: string, cidr: number) => new Subnet(this, id, {
            vpcId: mainVpc.id,
            cidrBlock: Fn.cidrsubnet(mainVpc.cidrBlock, 8, cidr),
            mapPublicIpOnLaunch: true,
            availabilityZone: `us-east-1${cidr === 1 ? 'a' : 'b'}`,
            tags: {prefix}
        });

        const subnet1 = createSubnet('subnet1', 1);
        const subnet2 = createSubnet('subnet2', 2);

        const igw = new InternetGateway(this, 'igw', {vpcId: mainVpc.id, tags: {name: 'main', prefix}});

        const routeTable = new RouteTable(this, 'routeTable', {
            vpcId: mainVpc.id,
            route: [{cidrBlock: '0.0.0.0/0', gatewayId: igw.id}]
        });

        new RouteTableAssociation(this, 'routeTableAssociation1', {subnetId: subnet1.id, routeTableId: routeTable.id});
        new RouteTableAssociation(this, 'routeTableAssociation2', {subnetId: subnet2.id, routeTableId: routeTable.id});

        const mainSg = new SecurityGroup(this, 'mainSG', {
            vpcId: mainVpc.id,
            name: `${prefix}-main-sg`,
            tags: {name: 'main', prefix},
            ingress: [{fromPort: 0, toPort: 0, protocol: '-1', cidrBlocks: ['0.0.0.0/0'], description: 'any'}],
            egress: [{fromPort: 0, toPort: 0, protocol: '-1', cidrBlocks: ['0.0.0.0/0'], description: 'any'}]
        });

        const accessSSH = new PrivateKey(this, 'accessSSH', {algorithm: 'RSA', rsaBits: 4096});

        new TerraformOutput(this, 'sshPrivateKey', {
            sensitive: true,
            value: accessSSH,
            description: 'The private SSH key'
        });

        const template = new LaunchTemplate(this, 'launchTemplate', {
            namePrefix: prefix,
            instanceType: 't3.micro',
            imageId: 'ami-07caf09b362be10b8',
            vpcSecurityGroupIds: [mainSg.id],
            blockDeviceMappings: [{deviceName: '/dev/sda1', ebs: {volumeType: "gp2", volumeSize: 8}}],
            tagSpecifications: [{resourceType: 'instance', tags: {key: 'Name', value: prefix}}],
        });

        const asg = new AutoscalingGroup(this, 'asg', {
            maxSize: 1, minSize: 1, desiredCapacity: 1,
            launchTemplate: {id: template.id, version: '$Latest'},
            vpcZoneIdentifier: [subnet1.id, subnet2.id],
            tag: [{key: 'AmazonECSManaged', value: 'true', propagateAtLaunch: true}]

        });

        const alb = new Alb(this, 'alb', {
            name: 'alb',
            internal: false,
            securityGroups: [mainSg.id],
            subnets: [subnet1.id, subnet2.id],
            enableDeletionProtection: false,
            enableHttp2: true,
            idleTimeout: 60,
            loadBalancerType: 'application',
            enableCrossZoneLoadBalancing: true,
            tags: {prefix}
        });

        const albTargetGroup = new AlbTargetGroup(this, 'albTargetGroup', {
            name: 'alb-target-group',
            port: 80,
            protocol: 'HTTP',
            vpcId: mainVpc.id,
            targetType: 'ip',
            healthCheck: {path: '/'},
            tags: {prefix}
        });

        new LbListener(this, 'albListener', {
            defaultAction: [{
                type: "forward",
                targetGroupArn: albTargetGroup.arn
            }], loadBalancerArn: alb.arn, port: 80, protocol: 'HTTP',

        });

        const ecsCluster = new EcsCluster(this, 'ecsCluster', {name: prefix.concat('-ecs-cluster')});

        const capacityProvider = new EcsCapacityProvider(this, 'ecsCapacityProvider', {
            autoScalingGroupProvider: {
                autoScalingGroupArn: asg.arn,
                managedScaling: {status: 'ENABLED', targetCapacity: 2, minimumScalingStepSize: 1},
            }, name: prefix.concat('-ecs-capacity-provider'),

        });

        new EcsClusterCapacityProviders(this, 'ecsClusterCapacityProviders', {
            clusterName: ecsCluster.name,
            capacityProviders: [capacityProvider.name],
            defaultCapacityProviderStrategy: [{capacityProvider: capacityProvider.name, base: 1, weight: 1}]

        });

        const executionRole = new IamRole(this, 'executionRole', {
            name: prefix.concat('-execution-role'),
            assumeRolePolicy: Fn.jsonencode({
                Version: '2012-10-17',
                Statement: [{
                    Effect: 'Allow',
                    Principal: {Service: 'ecs-tasks.amazonaws.com'},
                    Action: 'sts:AssumeRole'
                }]
            }),
            tags: {prefix}
        });
        const taskDef = new EcsTaskDefinition(this, 'ecsTaskDefinition', {
            family: prefix.concat('-task-def'),
            networkMode: 'awsvpc',
            cpu: '256',
            memory: '512',
            requiresCompatibilities: ['EC2'],
            runtimePlatform: {cpuArchitecture: 'X86_64', operatingSystemFamily: 'LINUX'},
            executionRoleArn:  executionRole.arn,
            containerDefinitions: Fn.jsonencode([{
                name: prefix.concat('-container'),
                image: 'kschltz/lanchonete:latest',
                portMappings: [{containerPort: 8080, hostPort: 8080, protocol: 'tcp'}],
                essential: true,
                logConfiguration: {
                    logDriver: 'awslogs',
                    options: {
                        'awslogs-group': '/ecs/'.concat(prefix),
                        'awslogs-region': 'us-east-1',
                        'awslogs-stream-prefix': 'ecs'.concat(prefix)
                    }
                }
            }])
        });

        new EcsService(this, 'ecsService', {
            name: prefix.concat('-service'),
            cluster: ecsCluster.arn,
            taskDefinition: taskDef.arn,
            desiredCount: 1,
            networkConfiguration: {
                subnets: [subnet1.id, subnet2.id],
                securityGroups: [mainSg.id],
            },
            forceNewDeployment: true,
            placementConstraints: [{type: 'distinctInstance'}],
            triggers: {redeployment: Fn.timestamp()},
            capacityProviderStrategy: [{capacityProvider: capacityProvider.name, weight: 100}],
            loadBalancer: [{
                targetGroupArn: albTargetGroup.arn,
                containerName: prefix.concat('-container'),
                containerPort: 8080
            }],
            dependsOn: [asg]

        });

        new TerraformOutput(this, 'publicIp',
            {value: alb.dnsName, description: 'The public IP of the ALB'})

    }
}