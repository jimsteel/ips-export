const smart   = require("fhirclient");
const session = require("express-session");
const app     = require("express")();
const uuidv4 = require("uuid");


// The SMART state is stored in a session. If you want to clear your session
// and start over, you will have to delete your "connect.sid" cookie!
app.use(session({
    secret: "my secret",
    resave: false,
    saveUninitialized: false
}));

// The settings that we use to connect to our SMART on FHIR server
const smartSettings = {
    clientId: "ips-exporter",
    redirectUri: "/app",
    scope: "launch/patient patient/*.read openid fhirUser",
    iss: "https://launch.smarthealthit.org/v/r4/fhir"
};


// Just a simple function to reply back with some data (the current patient if
// we know who he is, or all patients otherwise
async function handler(client, res) {
    console.log('Running handler for ' + client.patient.id);
    const data = await (
        client.patient.id ? client.patient.read() : client.request("Patient")
    );
    const practitioner = await (
        client.user.id ? client.user.read() : client.request("Practitioner")
    );
    var now = new Date().toISOString();
    console.log('Fetching MedicationStatements');
    const medicationStatements = await (
        client.patient.request('MedicationStatement')
        .catch(function(r3) {
            //Error responses
            if (r3.status){
                console.log('Error', r3.status);
            }
            //Errors
            if (r3.message){
                console.log('Error', r3.message);
            }
            return []
        })
    );
    console.log('Fetching MedicationRequests');
    const medicationRequests = await (
        client.patient.request('MedicationRequest')
        .catch(function(r3) {
            //Error responses
            if (r3.status){
                console.log('Error', r3.status);
            }
            //Errors
            if (r3.message){
                console.log('Error', r3.message);
            }
            return []
        })
    );
    var medsEntryList = medicationStatements.concat(medicationRequests);
    console.log('Meds list includes ' + medsEntryList.length);
    if (medsEntryList.length === 0) {
        medsEntryList.push({
            "resourceType": "MedicationStatement",
            "id": uuidv4(),
            "status": "active",
            "subject": "Patient/" + data.id,
            "medicationCodeableConcept": {
                "coding": [
                    {
                        "system": "http://build.fhir.org/ig/HL7/fhir-ips/CodeSystem-absent-unknown-uv-ips.html",
                        "code": "no-medication-info"
                    }
                ]
            },
            "effectiveDateTime": now
        });
    }
    console.log('Meds list includes ' + medsEntryList.length);
    var medicationsSection = {
        "title": "Medications Summary",
        "code": {
            "coding": [
                {
                    "system": "http://loinc.org",
                    "code": "10160-0"
                }
            ]
        },
        "entry": medsEntryList
    };
    var allergiesSection = {
        "title": "Allergies and Intolerances",
        "code": {
            "coding": [
                {
                    "system": "http://loinc.org",
                    "code": "48765-2"
                }
            ]
        },
        "entry": []
    };
    var problemsSection = {
        "title": "Problems",
        "code": {
            "coding": [
                {
                    "system": "http://loinc.org",
                    "code": "11450-4"
                }
            ]
        }
    };
    var composition = {
        "resourceType": "Composition",
        "meta": {
            "profile": ["http://hl7.org/fhir/uv/ips/StructureDefinition/Composition-uv-ips"]
        },
        "subject": {
            "reference": 'Patient/' + data.id
        },
        "author": [{
            "reference": "Practitioner/" + practitioner.id
        }],
        "title": "IPS summary for " + data.id,
        "status": "preliminary",
        "date": now,
        "type": {
            "coding": [
                {
                    "system": "http://loinc.org",
                    "code": "60591-5"
                }
            ]
        },
        "section": [
            medicationsSection,
            allergiesSection,
            problemsSection
        ]
    }
    console.log(JSON.stringify(composition));
    //const client2 = new Client()
    client.request({
        "url": "https://r4.ontoserver.csiro.au/fhir/Composition/$validate",
        "body": JSON.stringify(composition),
        "method": "POST",
        "credentials": "omit",
        "headers": { "Content-Type": "application/json"}
    }).then(function(r2) {
        console.log(r2);
        res.json(r2);
    }).catch(function(r3) {
        //Error responses
        if (r3.status){
            console.log('Error', r3.status);
        }
        //Errors
        if (r3.message){
            console.log('Error', r3.message);
        }
    });
    
} 

// =============================================================================
// LAUNCHING
// =============================================================================
// 1. If you remove the iss options and request https://c0che.sse.codesandbox.io/launch
//    it will throw because the FHIR service url is not known!
// 2. If an EHR calls it, it will append "launch" and "state" parameters. Try
//    it by loading https://c0che.sse.codesandbox.io/launch?iss=https://launch.smarthealthit.org/v/r3/fhir&launch=eyJhIjoiMSIsImciOiIxIn0
// 3. If you only add an "iss" url parameter (no "launch"), you are doing a
//    "dynamic" standalone launch. The app cannot obtain a launch context but
//    it is still useful to be able to do that. In addition, the SMART Sandbox
//    can be used to build a standalone launch url that contains embedded launch
//    context which may be perfect for previewing you app. For example load this
//    to launch the app with Angela Montgomery from DSTU-2:
//    https://c0che.sse.codesandbox.io/launch?iss=https://launch.smarthealthit.org/v/r2/sim/eyJrIjoiMSIsImIiOiJzbWFydC03Nzc3NzA1In0/fhir
// 4. We have an "iss" authorize option to make this do standalone launch by
//    default. In this case https://c0che.sse.codesandbox.io/launch will
//    not throw. Note that the "iss" url parameter takes precedence over the iss
//    option, so the app will still be launch-able from an EHR.
// 5. If an open server is passed as an "iss" option, or as "iss" url parameter,
//    no authorization attempt will be made and we will be redirected to the
//    redirect_uri (in this case we don't have launch context and there is no
//    selected patient so we show all patients instead). Try it:
//    https://c0che.sse.codesandbox.io/launch?iss=https://r3.smarthealthit.org
// 6. Finally, a "fhirServiceUrl" parameter can be passed as option or as url
//    parameter. It is like "iss" but will bypass the authorization (only useful
//    in testing and development). Example:
//    https://c0che.sse.codesandbox.io/launch?fhirServiceUrl=https://launch.smarthealthit.org/v/r3/fhir
app.get("/launch.html", (req, res, next) => {

    // ------------------------------------------------------------------------
    // CodeSandbox hack! Please ignore if you use this code elsewhere
    req.headers["x-forwarded-host"] = process.env.SANDBOX_URL
        .replace(/^https?:\/\//, "").replace(/\/$/, "");
    // ------------------------------------------------------------------------

    smart(req, res).authorize(smartSettings).catch(next);
});

// =============================================================================
// APP
// =============================================================================
// The app lives at your redirect_uri (in this case that is
// "https://c0che.sse.codesandbox.io/app"). After waiting for "ready()", you get
// a client instance that can be used to query the fhir server.
app.get("/app", (req, res) => {
    smart(req, res).ready()
    .then(client => handler(client, res))
    .catch(function(r2){
        //Error responses
        if (r2.status){
            console.log('Error', res.status);
        }

        //Errors
        if (r2.message){
            console.log('Error', res.message);
        }
    });
});

// =============================================================================
// SINGLE ROUTE
// =============================================================================
// In case you prefer to handle everything in one place, you can use the "init"
// method instead of "authorize" and then "ready". It takes the same options as
// "authorize"
app.get("/", (req, res) => {

    // ------------------------------------------------------------------------
    // CodeSandbox hack! Please ignore if you use this code elsewhere
    req.headers["x-forwarded-host"] = process.env.SANDBOX_URL
        .replace(/^https?:\/\//, "").replace(/\/$/, "");
    // ------------------------------------------------------------------------

    smart(req, res)
        .init({ ...smartSettings, redirectUri: "/" })
        .then(client => handler(client, res))
        .catch(function(r2){
            //Error responses
            if (r2.status){
                console.log('Error', res.status);
            }
    
            //Errors
            if (r2.message){
                console.log('Error', res.message);
            }
        });
    });


app.listen(8080);
