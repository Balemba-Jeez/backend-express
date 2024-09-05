/*IMPORTS SECTION */
const express = require('express'); // import express

const mysql = require('mysql2'); // import mysql

const axios = require('axios'); // import axios
 
require('dotenv').config(); // require and configure dotenv

const opencage = require('opencage-api-client');


/*API KEYS SECTION */
const apiKey = process.env.OPENCAGE_API_KEY;

const googlePlacesApiKey = process.env.GOOGLE_PLACES_API_KEY;



/*App SECTION */
const app = express(); //Create an object call app



/*Functions-Methods SECTION */

const connection = mysql.createConnection({  //Create MySQL DB connection
    host: 'localhost',
    user: 'root',
    password: 'r00t',
    database: 'gasspace'
})


// Connect to the MySQL database
connection.connect((err) => {
    if (err) {
        console.error('Error connecting to the database: ' + err.stack);
        return;
  }
    console.log('Connected to the database as ID ' + connection.threadId);
});

//Get Address from request
function getClientAddress(req) {
    const address = decodeURIComponent(req.params.address);

    return address;
}

 //Convert the address into latitude and longitude.
async function toCoordinates(address){
let addressCoordinates = null;

    
    try{

        const data = await opencage.geocode({ q: address });
    
        //console.log(JSON.stringify(data));
        if (data.status.code === 200 && data.results.length > 0) {

            const place = data.results[0];

            return place.geometry;

            /*console.log(place.formatted);

            console.log(place.geometry);

            console.log(place.annotations.timezone.name);*/

            

        } else {

            console.log('Status', data.status.message);

            console.log('total_results', data.total_results);
        }
    } catch(error)  {

    // console.log(JSON.stringify(error));

         console.log('Error', error.message);

    /* other possible response codes:
    // https://opencagedata.com/api#codes

        if (error.status && error.status.code === 402) {

        console.log('hit free trial daily limit');

        console.log('become a customer: https://opencagedata.com/pricing');

    }*/

  };

  
}

//Get all addresses from the Google Maps API that are within 3 km of the client's address using the Google Places API.
async function toFindNearby(coordinates){

  const {lat,lng} = coordinates;   // Destructure the latitude and longitude from the coordinates object.

    
  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=1000&key=${googlePlacesApiKey}`; // Our request

  try {
    const response = await axios.get(url); // Send the HTTP request to the Google Places API.

    const results = response.data.results; //Get the results from the response data.

    if (results.length > 0) {

        const addresses = results.map(place => place.vicinity); // Extract the vicinity (address) from each place result.

        return addresses; //Return list of addresses.
        
    } else {
        
        console.log('No nearby places found.'); // Log a message if no nearby places were found.

        return []; //Return an empty array.
    }
  } catch (error) {
    
    console.error('Error fetching nearby places:', error.message); // Log any errors that occurred during the API request.

    return []; // Return an empty array if an error occurred.
  }

}



//Query database for suppliers based on the NearBy addresses retrieved from the Google Maps API.
async function toQueryNearByDistanceFromDB(nearbyAddresses){

   const placeholders = nearbyAddresses.map(() => '?').join(', '); // Create placeholders for the query

   //const minimalRating = 3.5;

   const query = `
                 SELECT S.storeName, S.storeLogoImg , S.ID
                 FROM Suppliers S INNER JOIN supplierRatings R ON S.ID = R.supplierid
                 WHERE  S.address IN (${placeholders}) `;

                 
       return new Promise((resolve, reject) => {
       connection.query(query, [...nearbyAddresses], (error, results) => {
           if (error) {
               return reject('Error executing query: ' + error);
           }
           resolve(results); // Resolve the query results
       });
   });

}


//Query database for NearBy suppliers with rating >= 3.5.
 async  function toQueryNearByRatingFromDB(nearByDistanceQuery) {
        
        let nearByRating = [];

        nearByDistanceQuery.forEach((nearByDistanceQueryItem, index, arr) => {
            
            //Get Supplier ratings from supplierRatings Table
            const query = `
                 SELECT ratingValu 
                 FROM supplierRatings
                 WHERE  supplierid = ?`;

                 
       const ratingsPromise = new Promise((resolve, reject) => {

        // Execute the query, passing the supplier ID as a placeholder
       connection.query(query, [nearByDistanceQueryItem.ID], (error, results) => {
           if (error) {
               return reject('Error executing query: ' + error);
           }


           resolve(results); // Resolve the query results
       });
   });
    
        ratingsPromise
            .then((results) => {

                let AVGRating = 0; // Stores Average rating for particular Supplier

                let sum = 0; // Stores Sum of all ratings for particular Supplier

                results.forEach((ratingItem, index, arr) => {

                    sum = sum + ratingItem.ratingValu;

                })

                AVGRating = sum / results.length; //Calculate and set Average Supplier rating (AVG)

                //Checking if  Average Supplier rating (AVG) is greating >= 3.5

                if (AVGRating >= 3.5) {
                    
                    // Array to hold key-value pairs (excluding 'ID')
                    let subData = [];

                    // Iterate over each property in the object
                    for (let itemKey in nearByDistanceQueryItem) {

                        // Check if the current property is not 'ID'
                        if ( itemKey !== 'ID' ) {

                            // Push a new array with the key and value into subData
                            subData.push(['${itemKey}', nearByDistanceQueryItem[itemKey]]);
                           
                        }
                    }

                    nearByRating.push(Object.fromEntries(subData)); //Add supplier  

                    return nearByRating;
                }

                
            }).catch(error => {

                console.error('Error executing query:', error);
            })


        });


     }



// Route to get suppliers based on address
app.get('/api/Suppliers/:address',  async (req, res) => {
    
    const address = getClientAddress(req);  // Get the client's address from the request.

    const coordinates = await toCoordinates(address);  // Convert the address to coordinates.


   if (coordinates) {  // If coordinates were successfully retrieved...

        const nearbyAddresses = await toFindNearby(coordinates); // Find nearby addresses within 3 km.

        
        const nearByDistanceSuppliers  = await toQueryNearByDistanceFromDB(nearbyAddresses); // Find corresponding Suppliers to the nearby Address

        const nearByDistanceRateSuppliers = await toQueryNearByRatingFromDB(nearByDistanceSuppliers);

        console.log(nearByDistanceRateSuppliers);

        res.send(nearByDistanceRateSuppliers); // Send the nearby Suppliers to the client.


    } else {

        res.status(500).send('Error converting address to coordinates.');  // Send an error response if the address could not be converted.
    }

 } );




// Set the port number from environment variables or default to 4000.
const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`listening on port ${port}...`)); // Start the server and log the port it's listening on.