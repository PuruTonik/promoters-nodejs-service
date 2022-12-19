//import { createHash } from 'node:crypto'
const AWS = require('aws-sdk');
var crypto = require('crypto');
const axios = require('axios');
var MessageFormat = require('message-format');
AWS.config.update({
  region: 'ap-southeast-1'
});
const URL ="https://sms.8x8.com/api/v1/subaccounts/tonik_notif/messages";
const msg = "Hi, luv! Your password is {pwd}. Use this to log in to the Purple App. If you didn't make this request, ignore this message. XOXO";
const dynamodb = new AWS.DynamoDB.DocumentClient();
const dynamodbTableName = 'TDBK_BNPL_PRODUCT_DTL';
const promotersTableName = 'PROMOTERS_USER_DTL';
const healthPath = '/health';
const productPath = '/product';
const promoterPath = '/promoters/user';
const promoterloginPath = '/promoters/login';
const NO_RECORD_FOUND = 'No Data Found';
const INVALID_REQ = 'invalid request payload';
const EXPIRED = 'Request expired';
const USED = 'Product purchased';
const MIN_DIFF = 30;
const MAX_ATTEMP= 5;
exports.handler = async function (event) {
  console.log('Request event: ', event.httpMethod);
  let response;
  switch (true) {
    case event.httpMethod === 'GET' && event.path === healthPath:
      response = buildResponse(200);
      break;
    case event.httpMethod === 'GET' && event.path === productPath:
      response = await getProduct(event.queryStringParameters.productId);
      break;
    case event.httpMethod === 'POST' && event.path === productPath:
      response = await saveProduct(JSON.parse(event.body));
      break;
    case event.httpMethod === 'PATCH' && event.path === productPath:
      const requestBody = JSON.parse(event.body);
      response = await modifyProduct(requestBody.id, requestBody.loanId, requestBody.digitalUserId, requestBody.status);
      break;
    case event.httpMethod === 'POST' && event.path === promoterPath:
      response = await createUser(JSON.parse(event.body));
      break;
    case event.httpMethod === 'POST' && event.path === promoterloginPath:
      response = await validateLogin(JSON.parse(event.body));
      let verifyloginResp = JSON.parse(response.body);
      if(verifyloginResp.status==="x07")
      response = await wrongAttempt(JSON.parse(event.body),response)
      break;
    case event.httpMethod === 'PATCH' && event.path === promoterPath:
        response = await verifyUser(JSON.parse(event.body),response);
        let value = JSON.parse(response.body);
       if(value.status==="00")
        response = await changePwd(JSON.parse(event.body),response)
        break;
    case event.httpMethod === 'DELETE' && event.path === promoterPath:
          response = await lockUser(JSON.parse(event.body),response);
          break;
    default:
      response = buildResponse(404, NO_RECORD_FOUND);
  }
  return response;
}

async function getProduct(productId) {

          if (Object.keys(productId).length === 0)
            return buildResponse(400, "Bad Request");
          const params = {
            TableName: dynamodbTableName,
            Key: {
              'id': productId
            }
          }
          return await dynamodb.get(params).promise().then((response) => {
            const body = {
              operation: 'FETCH',
              status: '00',
              message: 'SUCCESS',
              data: response.Item
            }
            if (Object.keys(response).length === 0)
              return buildResponse(200, NO_RECORD_FOUND);
            if (MIN_DIFF < getMinutesBetweenDates(new Date(response.Item.createdOn), new Date())) {
              body.status = "x01";
              body.message = EXPIRED;
              body.data = null;
              return buildResponse(200, body);
            }
            if (response.Item.status === 'U') {
              body.status = "x02";
              body.message = USED;
              body.data = null;
              return buildResponse(200, body);
            }
            return buildResponse(200, body);
          }, (error) => {
            console.error('Unable to get the product details: ', error);
          });
        }

async function saveProduct(requestBody) {
          const timestamp = new Date().getTime();

          const reqbody = {
            id: requestBody.promoter.id.concat(timestamp),
            createdOn: timestamp,
            createdBy: requestBody.promoter.name,
            status: "I",
            digitalUserId: "",
            loanId: "",
            downPaymentAmount: requestBody.downPaymentAmount,
            tenureId: requestBody.tenureId,
            tenure: requestBody.tenure,
            loanableAmount: requestBody.loanableAmount,
            monthlyAmount: requestBody.monthlyAmount,
            total: requestBody.total,
            defaultDPamt:requestBody.defaultDPamt,
            defaultDP:requestBody.defaultDP,
            increasedDPamt:requestBody.increasedDPamt,
            promoter: {
              id: requestBody.promoter.id,
              name: requestBody.promoter.name,
              purpleKey: requestBody.promoter.purpleKey,
            },
            categories: requestBody.categories

          }

          console.log(reqbody);
          const params = {
            TableName: dynamodbTableName,
            Item: reqbody
          }
          return await dynamodb.put(params).promise().then(() => {
            const body = {
              operation: 'SAVE',
              status: '00',
              message: 'SUCCESS',
              data: reqbody
            }
            return buildResponse(201, body);
          }, (error) => {
            console.error('Unable to save the product details ', error);
          })
 }

async function modifyProduct(id, loanid, digitalId, statusVal) {
          if (isEmpty(id) || isEmpty(loanid) || isEmpty(digitalId) || isEmpty(statusVal) || statusVal != 'U')
            return buildResponse(400, INVALID_REQ);
          const params = {
            TableName: dynamodbTableName,
            Key: {
              'id': id
            },
            UpdateExpression: `set loanId = :value1 ,digitalId = :value2 ,#st = :value3`,
            ExpressionAttributeValues: {
              ':value1': loanid,
              ':value2': digitalId,
              ':value3': statusVal,
            },
            ExpressionAttributeNames: {
              "#st": "status",
            },
            ReturnValues: 'UPDATED_NEW'
          }
          return await dynamodb.update(params).promise().then((response) => {
            const body = {
              operation: 'UPDATE',
              status: '00',
              message: 'SUCCESS',
              data: response.Attributes
            }
            return buildResponse(200, body);
          }, (error) => {
            console.error('failed to update the status', error);
          })
}
async function createUser(requestBody) {
        const timestamp = new Date().getTime();
        var password = makePwd(8)
        const body = {
          operation: 'USER_CREATION',
          status: '',
          message: '',
          data: ''
        }
        const reqbody = {
          id:"P"+requestBody.location+ requestBody.userId,
          createdOn: timestamp,
          createdBy: requestBody.createdBy,
          status: "A", // A = Active , L=Locked  
          pwdStatus: "F", //Force Pwd change flag ( F = Force pwd , A = Active , R=Reset pwd , E=expired)
          pwdExpireDt: '',
          pwdChangedDt: timestamp,
          pwd:password,
          statuschangedDt: '',
          updatedOn: '',
          updatedBy: '',
          lastName: requestBody.lastName,
          firstName: requestBody.firstName,
          middleName: requestBody.middleName,
          dob: requestBody.dob, //MM/DD/YYYY
          address: requestBody.address,
          zipcode: requestBody.zipcode,
          province: requestBody.province,
          city: requestBody.city,
          barangay: requestBody.barangay,
          mobile: requestBody.mobile,
          area: requestBody.area,
          location:requestBody.location,
          storeId: requestBody.storeId,
          retryCt: 0 ,// Pwd retry count
          reason: ''

        }
        if (isEmpty(requestBody.userId) || isEmpty(requestBody.lastName) || isEmpty(requestBody.firstName) || isEmpty(requestBody.address) || isEmpty(requestBody.zipcode) ||
          isEmpty(requestBody.city) || isEmpty(requestBody.barangay) || isEmpty(requestBody.mobile) || isEmpty(requestBody.storeId) || isEmpty(requestBody.area) || !validateDateFormat(requestBody.dob))
          return buildResponse(400, "Bad Request");

        console.log(reqbody);
        const params = {
          TableName: promotersTableName,
          Item: reqbody
        }
        const respparams = {
          userId: "P"+requestBody.location+ requestBody.userId

        }

         await dynamodb.put(params).promise().then(() => {
          body.status='00';
          body.message= 'SUCCESS';
          body.data= respparams;
        
       
        }, (error) => {
          console.error('Unable to create promoter details ', error);
        })

        try{
          console.log("Send Pwd via SMS......");
          var message = new MessageFormat(msg);
          var formatted = message.format({ pwd:password });//,user:reqbody.id});
         // console.log("Msg:",formatted);
          const details={
                  source: "TONIK",
                  destination: requestBody.mobile,
                  text: formatted,
                  encoding: "AUTO",
                }
                let axiosConfig = {
                  headers: {
                           'Content-Type': 'application/json;charset=UTF-8',
                            "Access-Control-Allow-Origin": "*",
                            Authorization: 'Bearer 8iICA1E51416E6448E29BCD8439A73',
                            }
                            };
                await axios.post(URL, details, axiosConfig)
                    .then((res) => {
                        if (res != null) {
                         console.log("SMS Gateway Response :",res.data);
                        }
                    })
                    .catch((err) => {
                        console.log("AXIOS ERROR: ", err);
                    })
              
              
          } catch (error) {
                  console.log(error);
                  console.log("Sorry , we are unable to send SMS for this customer ",mobileno);
                }
                return buildResponse(201, body);
}
async function validateLogin(requestBody) {
        const timestamp = new Date().getTime();
        console.log("Login:",requestBody);

        if (isEmpty(requestBody.userId) || isEmpty(requestBody.password))
          return buildResponse(400, "Bad Request");


        const respparams = {
          userId: requestBody.userId,
          lastName: '',
          firstName: '',
          storeId: ''

        }
        const paramId = {
          TableName: promotersTableName,
          Key: {
            'id': requestBody.userId
          }
        }
        console.log("checking user details in db"+respparams);
        return await dynamodb.get(paramId).promise().then((response) => {
          //console.log("DB Pwd :"+JSON.stringify(response));
          //console.log("Req Pwd :"+requestBody.password);
          //console.log("Sizein DB :"+Object.keys(response).length);
          if (Object.keys(response).length > 0 && response.Item.pwd === requestBody.password && response.Item.status==="A" && response.Item.pwdStatus!="F") {
            respparams.lastName = response.Item.lastName;
            respparams.firstName = response.Item.firstName;
            respparams.storeId = response.Item.storeId;
            const body = {
              operation: 'VALIDATE_USER',
              status: '00',
              message: 'SUCCESS',
              data: respparams
            }
            return buildResponse(200, body);
          } 
          else if(Object.keys(response).length > 0 && response.Item.status!="A")
          {
            const body = {
              operation: 'VALIDATE_USER',
              status: 'x04',
              message: 'Please call your territory manager',

            }
            return buildResponse(200, body);
          }
          else if(Object.keys(response).length > 0 && response.Item.pwd === requestBody.password && response.Item.pwdStatus==="F")
          {
            const body = {
              operation: 'VALIDATE_USER',
              status: 'x05',
              message: 'Please change your temporary password',

            }
            return buildResponse(200, body);
          }
          else if(Object.keys(response).length > 0 && response.Item.pwd != requestBody.password)
          {
            const body = {
              operation: 'VALIDATE_USER',
              status: 'x07',
              message: 'Please enter a valid username and password',
              data:response

            }
            //wrongAttempt(response);
            return buildResponse(200, body);
          }
          else {
            const body = {
              operation: 'VALIDATE_USER',
              status: 'x03',
              message: 'Please enter a valid username and password',

            }
            
            return buildResponse(200, body);
          }


        }, (error) => {
          console.error('Unable to create promoter details ', error);
        })
}
async function verifyUser(requestBody) {
        const timestamp = new Date().getTime();
        console.log("Login:",requestBody);

        if (isEmpty(requestBody.userId) || isEmpty(requestBody.password))
          return buildResponse(400, "Bad Request");

        const paramId = {  
          TableName: promotersTableName,
          Key: {
            'id': requestBody.userId
          }
        }
        ///console.log("checking user details in db"+respparams);
        return await dynamodb.get(paramId).promise().then((response) => {
        
          if (Object.keys(response).length > 0 && response.Item.status==="A") {
            response.Item.pwd=requestBody.password;
            response.Item.pwdChangedDt=timestamp;
            response.Item.pwdStatus="A";
            response.Item.updatedBy=response.Item.lastName;
            response.Item.updatedOn=timestamp;
            response.Item.retryCt=0;
            response.Item.status="A";
            const body = {
              operation: 'VALIDATE_USER',
              status: '00',
              message: 'SUCCESS',
              data: response
            }
            
            return buildResponse(200, body);
            
          } 
          else if(Object.keys(response).length > 0 && response.Item.status==="L")
          {
            const body = {
              operation: 'VALIDATE_USER',
              status: 'x04',
              message: 'Please call your territory manager',

            }
            return buildResponse(200, body);
          }
          else if(Object.keys(response).length > 0 && response.Item.pwdStatus==="F")
          {
            const body = {
              operation: 'VALIDATE_USER',
              status: 'x05',
              message: 'Please change password',

            }
            return buildResponse(200, body);
          }
          
          else {
            const body = {
              operation: 'VALIDATE_USER',
              status: 'x03',
              message: 'Please enter a valid username and password',

            }
            return buildResponse(200, body);
          }


        }, (error) => {
          console.error('Unable to create promoter details ', error);
          const body = {
            operation: 'VALIDATE_USER',
            status: 'x06',
            message: 'Please enter a valid username and password',

          }
          return buildResponse(200, body);
        })
}

async function changePwd(request,response){
        //console.log("Request :"+JSON.stringify(request));
        //console.log("Response :",JSON.stringify(response.body));
        let responseData = JSON.parse(response.body);
        //console.log("===>"+JSON.stringify(responseData));
        const respparams = {
          userId: responseData.data.Item.id,
          lastName: responseData.data.Item.lastName,
          firstName: responseData.data.Item.firstName,
          storeId: responseData.data.Item.storeId

        }
        responseData.data.Item.pwd= request.password;
        responseData.data.Item.pwdStatus="A";
        responseData.data.Item.retryCt=0;
      
        const params = {
          TableName: promotersTableName,
          Item: responseData.data.Item
        }
        //console.log("update password1",JSON.stringify(params));
        return await dynamodb.put(params).promise().then(() => {
          //console.log("update password2");
          const body = {
            operation: 'UPDATE_PWD',
            status: '00',
            message: 'SUCCESS',
            data: respparams
          }
          console.log("User :"+responseData.data.Item.id+" Password successfully updated...")
          return buildResponse(200, body);
        }, (error) => {
          console.error('Unable to update  the user pwd details ', error,request.userId);
          return buildResponse(404, "Bad Request");
        })

}
async function lockUser(request){
 console.log("Request for user deactivate:",request);
  const timestamp = new Date().getTime();
  if (isEmpty(request.userId) || isEmpty(request.status)||isEmpty(request.reason)||isEmpty(request.updatedBy))
          return buildResponse(400, "Bad Request");
          const params = {
            TableName: promotersTableName,
            Key: {
              'id': request.userId
            },
            UpdateExpression: `set #st = :value1 ,reason = :value2 ,statuschangedDt = :value3 ,updatedOn = :value4,updatedBy = :value5`,
            ExpressionAttributeValues: {
              ':value1': request.status,
              ':value2': request.reason,
              ':value3': timestamp,
			        ':value4': timestamp,
			        ':value5': request.updatedBy,
            },
            ExpressionAttributeNames: {
              "#st": "status",
            },
            ReturnValues: 'UPDATED_NEW'
          }
  const body = {
    operation: 'LOCK_USER',
    status: 'x08',
    message: ''
  }
  //console.log("update password1",JSON.stringify(params));
  return await dynamodb.update(params).promise().then((response) => {
    console.log("update user status...");
    body.status='00';
    body.message='your account has been successfully deactivated ';
    console.log("User :"+request.userId+" deactivated successfully ...")
    return buildResponse(200, body);
  }, (error) => {
    console.error('Unable to update  the user pwd details ', error,request.userId);
    return buildResponse(404, "Bad Request");
  })
  
}

async function wrongAttempt(reqbody,response){
        let responseData = JSON.parse(response.body);
        console.log(JSON.stringify(responseData))
        responseData.data.Item.retryCt = responseData.data.Item.retryCt+1;
        if(MAX_ATTEMP<=responseData.data.Item.retryCt)
        {
          responseData.data.Item.status="L";
          
        }
        const params = {
          TableName: promotersTableName,
          Item: responseData.data.Item
        }
        return await dynamodb.put(params).promise().then(() => {
          const body = {
            operation: 'VALIDATE_USER',
            status: 'x03',
            message: 'Please enter a valid username and password'
            //data: reqbody
          }
          return buildResponse(200, body);
        }, (error) => {
          console.error('Unable to save the product details ', error);
          return buildResponse(400, "Bad Request");
        })

}
const isEmpty = (value) => (
  value === undefined ||
  value === null ||
  (typeof value === 'object' && Object.keys(value).length === 0) ||
  (typeof value === 'string' && value.trim().length === 0)
)
function buildResponse(statusCode, body) {
        return {
          statusCode: statusCode,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Headers": "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
            "Access-Control-Allow-Methods": "OPTIONS,POST,GET,PATCH",
            "Access-Control-Allow-Credentials": true,
            "Access-Control-Allow-Origin": "*",
            "X-Requested-With": "*"
          },
          body: JSON.stringify(body)
        }
}
function getMinutesBetweenDates(startDate, endDate) {
        var diff = endDate.getTime() - startDate.getTime();
        console.log("time diff :", diff)
        return (diff / 60000);
}
function makePwd(length) {
        var result = '';
        var characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        var charactersLength = characters.length;
        for (var i = 0; i < length; i++) {
          result += characters.charAt(Math.floor(Math.random() * charactersLength));
        }
        console.log("Pwd:" + result);
        //return crypto.createHash('md5').update(result).digest('hex');
        return result;
}
function validateDateFormat(dateStr) {
        //MM/DD/YYYY
        var date_regex = /^(0[1-9]|1[0-2])\/(0[1-9]|1\d|2\d|3[01])\/(19|20)\d{2}$/;
        if (!(date_regex.test(dateStr))) {
          console.log("dob wrong");
          return false;

        }
        console.log("dob correct");
        return true;
}



