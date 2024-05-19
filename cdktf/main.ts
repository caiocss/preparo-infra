import {App, S3Backend, TerraformStack} from "cdktf";
import {LanchoneteConstruct} from "./lib/lanchonete";
import {Construct} from "constructs";
import {AwsProvider} from "@cdktf/provider-aws/lib/provider";
import {Vpc} from "@cdktf/provider-aws/lib/vpc";


class DevStack extends TerraformStack {
    constructor(scope: Construct, id: string) {
        super(scope, id);

        new AwsProvider(scope, 'aws',
            {region: 'us-east-1'});


        const mainVpc = new Vpc(this, 'vpc', {
            cidrBlock: "10.0.0.0/16",
            enableDnsHostnames: true,
            tags: {name: 'main', prefix: "development"}
        });

        new LanchoneteConstruct(this, "lanchonete", {
            mainVpc: mainVpc,
            prefix: "lanchonete",
            dockerImage: 'kschltz/lanchonete:latest'
        });
    }
}


const app = new App();
const devStack = new DevStack(app, 'development');
new S3Backend(devStack,
    {key: "terraform/terraform.state", bucket: "lanchonete", region: "us-east-1"}
)
app.synth();

